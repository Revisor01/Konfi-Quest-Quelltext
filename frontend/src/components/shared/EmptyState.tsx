import React from 'react';
import { IonIcon } from '@ionic/react';

interface EmptyStateProps {
  icon: string;
  title: string;
  message: string;
  iconColor?: string;
}

const EmptyState: React.FC<EmptyStateProps> = ({
  icon,
  title,
  message,
  iconColor = '#999',
}) => {
  return (
    <div className="app-empty-state">
      <IonIcon
        icon={icon}
        className="app-empty-state__icon"
        style={{ color: iconColor }}
      />
      <h3 className="app-empty-state__title">{title}</h3>
      <p className="app-empty-state__text">{message}</p>
    </div>
  );
};

export default EmptyState;
