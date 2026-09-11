import React from 'react';
import { IonButtons, IonButton, IonIcon } from '@ionic/react';
import { useIonRouter } from '@ionic/react';
import { ICON_PROFIL } from './icons';

interface ProfileHeaderButtonProps {
  href: string;
  variant?: 'konfis' | 'teamer' | 'users';
}

/**
 * Profil-Button oben rechts im IonHeader. Wird in IonButtons slot="end" als Child eingehängt.
 * Farbe aus globalen Tokens — keine Inline-Hex.
 */
const ProfileHeaderButton: React.FC<ProfileHeaderButtonProps> = ({ href, variant = 'konfis' }) => {
  const router = useIonRouter();
  const colorClass = `app-icon-color--${variant}`;
  return (
    <IonButtons slot="end">
      <IonButton onClick={() => router.push(href)} aria-label="Profil öffnen">
        <IonIcon
          slot="icon-only"
          icon={ICON_PROFIL}
          className={colorClass}
          style={{ fontSize: 'var(--app-anzeige-basis)' }}
        />
      </IonButton>
    </IonButtons>
  );
};

export default ProfileHeaderButton;
