import { ImageResponse } from 'next/og';

export const size = { width: 180, height: 180 };
export const contentType = 'image/png';

export default function AppleIcon() {
  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          background: 'linear-gradient(135deg, #7B1FA2, #D91CD2)',
          borderRadius: '36px',
        }}
      >
        <svg
          viewBox="0 0 32 32"
          width="108"
          height="108"
          fill="none"
        >
          <path
            d="M20.5 8C20.5 8 22.5 8 22.5 10.5C22.5 13 18 13.5 16 14.5C14 15.5 9.5 16 9.5 19.5C9.5 23 13 24 13 24"
            stroke="white"
            strokeWidth="3"
            strokeLinecap="round"
            fill="none"
          />
          <circle cx="16" cy="7.5" r="2" fill="white" opacity="0.6" />
          <circle cx="16" cy="24.5" r="2" fill="white" opacity="0.6" />
        </svg>
      </div>
    ),
    { ...size }
  );
}
