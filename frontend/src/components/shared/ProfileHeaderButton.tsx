import React from 'react';
import { IonButtons, IonButton, IonIcon } from '@ionic/react';
import { useIonRouter } from '@ionic/react';
import { personCircleOutline } from 'ionicons/icons';

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
      <IonButton onClick={() => router.push(href)}>
        <IonIcon
          slot="icon-only"
          icon={personCircleOutline}
          className={colorClass}
          style={{ fontSize: '1.7rem' }}
        />
      </IonButton>
    </IonButtons>
  );
};

export default ProfileHeaderButton;
