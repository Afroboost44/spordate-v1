"use client";

/**
 * Phase 9 sub-chantier 3 commit 3/5 — UI opt-in/opt-out push notifications.
 *
 * Pattern cohérent aiSuggestionsOptIn Phase 8 SC0 (default-on opt-out via /profile).
 *
 * Flow :
 *  - Mount : lit `userProfile.pushNotificationsEnabled` (undefined === true default-on)
 *  - On toggle ON :
 *    * registerPushNotifications(uid) → permission prompt + FCM getToken + persist users.{uid}.fcmToken
 *    * Si reason='permission-denied'/'permission-default' → toast info + revert toggle
 *    * Si reason='unsupported' (Q6=A Safari iOS <16.4) → Switch disabled silently
 *  - On toggle OFF :
 *    * unregisterPushNotifications(uid) → remove fcmToken + opt-out flag
 *    * Toast "Notifications désactivées"
 *
 * Charte stricte black/#D91CD2/white (cohérent autres Switch profile).
 */

import * as React from 'react';
import { useEffect, useState } from 'react';
import { Bell, BellOff } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { Switch } from '@/components/ui/switch';
import {
  isPushSupported,
  registerPushNotifications,
  unregisterPushNotifications,
} from '@/lib/notifications/registerPush';

export interface PushOptInSwitchProps {
  uid: string;
  /** Initial state from UserProfile.pushNotificationsEnabled (undefined === true default-on). */
  initialEnabled?: boolean;
}

export function PushOptInSwitch({ uid, initialEnabled }: PushOptInSwitchProps) {
  const { toast } = useToast();
  // Default-on : undefined → true (cohérent aiSuggestionsOptIn pattern)
  const [enabled, setEnabled] = useState<boolean>(initialEnabled !== false);
  const [saving, setSaving] = useState(false);
  const [supported, setSupported] = useState<boolean>(true);

  useEffect(() => {
    setSupported(isPushSupported());
  }, []);

  const handleToggle = async (checked: boolean): Promise<void> => {
    if (!uid || saving) return;
    const previous = enabled;
    setEnabled(checked); // optimistic
    setSaving(true);

    try {
      if (checked) {
        // Toggle ON : register push
        const result = await registerPushNotifications(uid);
        if (result.ok) {
          toast({
            title: 'Notifications activées',
            description: 'Tu recevras les rappels de session et reviews directement.',
            className: 'bg-green-600 text-white',
          });
        } else {
          // Revert toggle si fail
          setEnabled(previous);
          let userMessage = "Impossible d'activer les notifications.";
          if (result.reason === 'permission-denied') {
            userMessage =
              'Permission refusée par ton navigateur. Tu peux la réactiver depuis les paramètres du site.';
          } else if (result.reason === 'permission-default') {
            userMessage = 'Tu as fermé la demande sans répondre. Réessaye et clique "Autoriser".';
          } else if (result.reason === 'unsupported') {
            userMessage =
              'Ton navigateur ne supporte pas les notifications push (Safari iOS <16.4 par exemple).';
          } else if (result.reason === 'no-vapid-key') {
            userMessage = 'Configuration push manquante côté serveur. Réessaye plus tard.';
          }
          toast({
            title: 'Activation impossible',
            description: userMessage,
            variant: 'destructive',
          });
        }
      } else {
        // Toggle OFF : unregister push
        const result = await unregisterPushNotifications(uid);
        if (result.ok) {
          toast({
            title: 'Notifications désactivées',
            description: 'Tu recevras toujours les emails fallback.',
            className: 'bg-zinc-700 text-white',
          });
        } else {
          setEnabled(previous);
          toast({
            title: 'Désactivation impossible',
            description: 'Réessaye dans un instant.',
            variant: 'destructive',
          });
        }
      }
    } catch (err) {
      setEnabled(previous);
      console.warn('[PushOptInSwitch] toggle error', err);
      toast({
        title: 'Erreur',
        description: 'Réessaye dans un instant.',
        variant: 'destructive',
      });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="flex items-start justify-between gap-4 py-2">
      <div className="flex-1 min-w-0">
        <label
          htmlFor="push-opt-in-toggle"
          className="text-sm font-medium text-white cursor-pointer flex items-center gap-1.5"
        >
          {enabled ? (
            <Bell className="h-3.5 w-3.5 text-accent" aria-hidden="true" />
          ) : (
            <BellOff className="h-3.5 w-3.5 text-white/40" aria-hidden="true" />
          )}
          Notifications push
        </label>
        <p className="text-xs text-white/40 mt-1 leading-relaxed">
          {supported ? (
            <>
              Activées par défaut. Recevoir rappels session (J-1, T-1h) et reviews directement
              dans ton navigateur (au lieu d&apos;email). Email fallback si désactivé.
            </>
          ) : (
            <>
              Ton navigateur ne supporte pas les notifications push (Safari iOS &lt;16.4 par exemple).
              Tu recevras les rappels par email uniquement.
            </>
          )}
        </p>
      </div>
      <Switch
        id="push-opt-in-toggle"
        checked={enabled && supported}
        onCheckedChange={handleToggle}
        disabled={saving || !supported}
        className="mt-1 data-[state=checked]:bg-accent flex-shrink-0"
      />
    </div>
  );
}
