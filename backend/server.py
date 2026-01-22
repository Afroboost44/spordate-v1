"""
FastAPI Backend for Spordateur - Stripe Payment Integration
This backend handles all /api routes that the Emergent infrastructure expects on port 8001
"""

import os
import stripe
from fastapi import FastAPI, Request, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from pydantic import BaseModel
from typing import Optional, Dict
from dotenv import load_dotenv

# Load environment variables
# Priority: Kubernetes secrets (already in env) > .env.local (has real keys) > backend/.env (defaults)
# Load in reverse order so higher priority overrides lower
env_paths = ["/app/backend/.env", "/app/.env.local"]
for env_path in env_paths:
    if os.path.exists(env_path):
        load_dotenv(env_path, override=True)  # Override with higher priority files
        print(f"[Backend] Loaded environment from {env_path}")

app = FastAPI(title="Spordateur API", version="1.0.0")

# CORS middleware
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Fixed packages - NEVER accept amounts from frontend
PACKAGES = {
    "solo": 25.00,  # 25€
    "duo": 50.00,   # 50€
}

# Get Stripe key
STRIPE_SECRET_KEY = os.environ.get("STRIPE_SECRET_KEY")
STRIPE_WEBHOOK_SECRET = os.environ.get("STRIPE_WEBHOOK_SECRET")

print(f"[Backend] Starting server...")
print(f"[Backend] STRIPE_SECRET_KEY present: {bool(STRIPE_SECRET_KEY)}")
if STRIPE_SECRET_KEY:
    print(f"[Backend] Key prefix: {STRIPE_SECRET_KEY[:15]}...")


class CheckoutRequest(BaseModel):
    packageType: str
    originUrl: str
    metadata: Optional[Dict[str, str]] = {}


@app.get("/")
async def root():
    """Root endpoint for health checks"""
    return {"status": "ok", "service": "spordateur-api"}


class CheckoutResponse(BaseModel):
    url: str
    sessionId: str


# Routes with /api prefix (expected by the infrastructure)
@app.get("/api/health")
async def api_health_check():
    """Health check endpoint"""
    return {
        "status": "healthy",
        "stripe_configured": bool(STRIPE_SECRET_KEY),
    }


# Also add routes without /api prefix in case the ingress strips it
@app.get("/health")
async def health_check():
    """Health check endpoint (without /api prefix)"""
    return {
        "status": "healthy",
        "stripe_configured": bool(STRIPE_SECRET_KEY),
    }


@app.post("/api/checkout", response_model=CheckoutResponse)
@app.post("/checkout", response_model=CheckoutResponse)
async def create_checkout_session(request: CheckoutRequest):
    """Create a Stripe Checkout Session"""
    print(f"[Checkout] Request received: {request}")
    
    if not STRIPE_SECRET_KEY:
        print("[Checkout] ERROR: STRIPE_SECRET_KEY not configured")
        raise HTTPException(
            status_code=503,
            detail="Stripe is not configured. Please add STRIPE_SECRET_KEY to environment variables."
        )
    
    # Validate package type
    if request.packageType not in PACKAGES:
        print(f"[Checkout] ERROR: Invalid package type: {request.packageType}")
        raise HTTPException(
            status_code=400,
            detail=f'Invalid package type. Must be "solo" or "duo", got "{request.packageType}"'
        )
    
    # Validate origin URL
    if not request.originUrl:
        print("[Checkout] ERROR: Missing originUrl")
        raise HTTPException(status_code=400, detail="Origin URL is required")
    
    try:
        # Initialize Stripe
        stripe.api_key = STRIPE_SECRET_KEY
        
        amount = PACKAGES[request.packageType]
        
        # Build success and cancel URLs
        success_url = f"{request.originUrl}/discovery?payment=success&session_id={{CHECKOUT_SESSION_ID}}"
        cancel_url = f"{request.originUrl}/discovery?payment=cancelled"
        
        print(f"[Checkout] Creating session: amount={amount}, packageType={request.packageType}")
        print(f"[Checkout] Success URL: {success_url}")
        
        # Create Stripe Checkout Session
        session = stripe.checkout.Session.create(
            payment_method_types=["card"],
            mode="payment",
            line_items=[
                {
                    "price_data": {
                        "currency": "eur",
                        "product_data": {
                            "name": "Séance Duo Afroboost (2 places)" if request.packageType == "duo" else "Séance Solo Afroboost",
                            "description": "Ticket pour 2 personnes - Offrez une séance à votre partenaire" if request.packageType == "duo" else "Ticket individuel pour une séance sportive",
                        },
                        "unit_amount": int(amount * 100),  # Convert to cents
                    },
                    "quantity": 1,
                }
            ],
            success_url=success_url,
            cancel_url=cancel_url,
            metadata={
                **request.metadata,
                "packageType": request.packageType,
                "amount": str(amount),
            },
        )
        
        print(f"[Checkout] Session created successfully: {session.id}")
        
        return CheckoutResponse(url=session.url, sessionId=session.id)
        
    except stripe.error.StripeError as e:
        print(f"[Checkout] Stripe error: {str(e)}")
        raise HTTPException(status_code=500, detail=f"Stripe error: {str(e)}")
    except Exception as e:
        print(f"[Checkout] Unexpected error: {str(e)}")
        raise HTTPException(status_code=500, detail=f"Failed to create checkout session: {str(e)}")


@app.get("/api/checkout/status/{session_id}")
async def get_checkout_status(session_id: str):
    """Get the status of a checkout session"""
    print(f"[Status] Checking session: {session_id}")
    
    if not STRIPE_SECRET_KEY:
        raise HTTPException(status_code=503, detail="Stripe is not configured")
    
    try:
        stripe.api_key = STRIPE_SECRET_KEY
        session = stripe.checkout.Session.retrieve(session_id)
        
        return {
            "sessionId": session.id,
            "status": session.status,
            "paymentStatus": session.payment_status,
            "customerEmail": session.customer_details.email if session.customer_details else None,
            "amountTotal": session.amount_total,
            "currency": session.currency,
            "metadata": session.metadata,
        }
    except stripe.error.StripeError as e:
        print(f"[Status] Stripe error: {str(e)}")
        raise HTTPException(status_code=500, detail=f"Stripe error: {str(e)}")


@app.post("/api/webhooks/stripe")
async def stripe_webhook(request: Request):
    """Handle Stripe webhook events"""
    print("[Webhook] Received webhook event")
    
    payload = await request.body()
    sig_header = request.headers.get("stripe-signature")
    
    if STRIPE_WEBHOOK_SECRET and sig_header:
        try:
            stripe.api_key = STRIPE_SECRET_KEY
            event = stripe.Webhook.construct_event(
                payload, sig_header, STRIPE_WEBHOOK_SECRET
            )
        except ValueError as e:
            print(f"[Webhook] Invalid payload: {e}")
            raise HTTPException(status_code=400, detail="Invalid payload")
        except stripe.error.SignatureVerificationError as e:
            print(f"[Webhook] Invalid signature: {e}")
            raise HTTPException(status_code=400, detail="Invalid signature")
    else:
        # For testing without signature verification
        import json
        event = json.loads(payload)
    
    event_type = event.get("type") if isinstance(event, dict) else event.type
    print(f"[Webhook] Event type: {event_type}")
    
    # Handle specific events
    if event_type == "checkout.session.completed":
        session = event.get("data", {}).get("object", {}) if isinstance(event, dict) else event.data.object
        print(f"[Webhook] Checkout completed: {session.get('id') if isinstance(session, dict) else session.id}")
        
        # TODO: Update booking status in database
        # TODO: Send confirmation emails
        
    return {"received": True}


# Catch-all for any other API routes
@app.api_route("/api/{path:path}", methods=["GET", "POST", "PUT", "DELETE"])
async def catch_all(path: str, request: Request):
    """Catch-all for undefined API routes"""
    print(f"[API] Undefined route accessed: /api/{path}")
    return JSONResponse(
        status_code=404,
        content={"error": f"API route not found: /api/{path}"}
    )
