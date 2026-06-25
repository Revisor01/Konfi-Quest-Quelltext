import React from 'react';
import {
  IonList,
  IonListHeader,
  IonCard,
  IonCardContent,
  IonLabel,
  IonIcon,
} from '@ionic/react';
import EmptyState from './EmptyState';

interface ListSectionProps {
  icon: string;
  title: string;
  count: number;
  iconColorClass?: string;
  children: React.ReactNode;
  emptyIcon?: string;
  emptyTitle?: string;
  emptyMessage?: string;
  emptyIconColor?: string;
  isEmpty?: boolean;
}

const ListSection: React.FC<ListSectionProps> = ({
  icon,
  title,
  count,
  iconColorClass,
  children,
  emptyIcon,
  emptyTitle,
  emptyMessage,
  emptyIconColor,
  isEmpty,
}) => {
  // Leerzustand anzeigen, wenn isEmpty explizit true ist
  // oder wenn count === 0 und emptyIcon angegeben wurde
  const showEmpty = isEmpty === true || (count === 0 && !!emptyIcon);

  return (
    <IonList inset={true} style={{ margin: '16px' }}>
      <IonListHeader>
        <div className={`app-section-icon${iconColorClass ? ` app-section-icon--${iconColorClass}` : ''}`}>
          <IonIcon icon={icon} />
        </div>
        <IonLabel>{title} ({count})</IonLabel>
      </IonListHeader>
      <IonCard className="app-card">
        <IonCardContent style={{ padding: showEmpty ? '16px' : '12px' }}>
          {showEmpty && emptyIcon && emptyTitle && emptyMessage ? (
            <EmptyState
              icon={emptyIcon}
              title={emptyTitle}
              message={emptyMessage}
              iconColor={emptyIconColor}
            />
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column' }}>
              {children}
            </div>
          )}
        </IonCardContent>
      </IonCard>
    </IonList>
  );
};

export default ListSection;
