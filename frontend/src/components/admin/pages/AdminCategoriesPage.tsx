import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  IonPage,
  IonHeader,
  IonToolbar,
  IonTitle,
  IonContent,
  IonRefresher,
  IonRefresherContent,
  IonButtons,
  IonButton,
  IonIcon,
  useIonModal,
  useIonAlert,
  IonCard,
  IonCardContent,
  IonItem,
  IonLabel,
  IonList,
  IonListHeader,
  IonItemSliding,
  IonItemOptions,
  IonItemOption,
  IonInput,
  IonTextarea,
  IonSpinner
} from '@ionic/react';
import {
  add,
  pricetag,
  checkmarkOutline,
  closeOutline,
  arrowBack,
  trash,
  informationCircleOutline,
  pricetagOutline
} from 'ionicons/icons';
import { useApp } from '../../../contexts/AppContext';
import { useModalPage } from '../../../contexts/ModalContext';
import { useLiveRefresh } from '../../../contexts/LiveUpdateContext';
import api from '../../../services/api';
import { writeQueue } from '../../../services/writeQueue';
import { networkMonitor } from '../../../services/networkMonitor';
import { useOfflineQuery } from '../../../hooks/useOfflineQuery';
import { CACHE_TTL } from '../../../services/offlineCache';
import LoadingSpinner from '../../common/LoadingSpinner';
import { SectionHeader, ListSection } from '../../shared';
import { triggerPullHaptic } from '../../../utils/haptics';
import { safeUUID } from '../../../utils/uuid';

interface Category {
  id: number;
  name: string;
  description?: string;
  created_at: string;
}

interface CategoryModalProps {
  category?: Category | null;
  onClose: () => void;
  onSuccess: () => void;
  dismiss?: () => void;
}

const CategoryModal: React.FC<CategoryModalProps> = ({
  category,
  onClose,
  onSuccess,
  dismiss
}) => {
  const handleClose = () => {
    if (dismiss) {
      dismiss();
    } else {
      onClose();
    }
  };
  const { setSuccess, setError } = useApp();
  const [loading, setLoading] = useState(false);
  
  const [formData, setFormData] = useState({
    name: '',
    description: ''
  });

  useEffect(() => {
    if (category) {
      setFormData({
        name: category.name,
        description: category.description || ''
      });
    } else {
      setFormData({
        name: '',
        description: ''
      });
    }
  }, [category]);

  const handleSubmit = async () => {
    if (!formData.name.trim()) {
      setError('Name ist erforderlich');
      return;
    }

    const payload = {
      name: formData.name.trim(),
      description: formData.description.trim() || null
    };

    if (networkMonitor.isOnline) {
      setLoading(true);
      try {
        if (category) {
          await api.put(`/admin/categories/${category.id}`, payload);
        } else {
          await api.post('/admin/categories', payload);
        }

        onSuccess();
        handleClose();
      } catch (error: any) {
        if (error.response?.data?.error) {
          setError(error.response.data.error);
        } else {
          setError('Fehler beim Speichern der Kategorie');
        }
      } finally {
        setLoading(false);
      }
    } else {
      await writeQueue.enqueue({
        method: category ? 'PUT' : 'POST',
        url: category ? `/admin/categories/${category.id}` : '/admin/categories',
        body: payload,
        maxRetries: 5,
        hasFileUpload: false,
        metadata: {
          type: 'admin',
          clientId: safeUUID(),
          label: category ? 'Kategorie bearbeiten' : 'Kategorie erstellen'
        }
      });
      setSuccess('Wird gespeichert sobald du wieder online bist');
      onSuccess();
      handleClose();
    }
  };

  return (
    <IonPage>
      <IonHeader>
        <IonToolbar>
          <IonTitle>
            {category ? 'Kategorie bearbeiten' : 'Neue Kategorie'}
          </IonTitle>
          <IonButtons slot="start">
            <IonButton onClick={handleClose} disabled={loading}>
              <IonIcon icon={closeOutline} />
            </IonButton>
          </IonButtons>
          <IonButtons slot="end">
            <IonButton
              onClick={handleSubmit}
              disabled={!formData.name.trim() || loading}
            >
              {loading ? (
                <IonSpinner name="crescent" />
              ) : (
                <IonIcon icon={checkmarkOutline} />
              )}
            </IonButton>
          </IonButtons>
        </IonToolbar>
      </IonHeader>

      <IonContent className="app-gradient-background">
        {/* Kategorie Details - iOS26 Pattern */}
        <IonList inset={true} style={{ margin: '16px' }}>
          <IonListHeader>
            <div className="app-section-icon app-section-icon--categories">
              <IonIcon icon={pricetag} />
            </div>
            <IonLabel>Kategorie Details</IonLabel>
          </IonListHeader>
          <IonCard className="app-card">
            <IonCardContent>
              <IonList style={{ background: 'transparent', padding: '0' }}>
                <IonItem lines="full" style={{ '--background': 'transparent' }}>
                  <IonLabel position="stacked">Name *</IonLabel>
                  <IonInput
                    value={formData.name}
                    onIonInput={(e) => setFormData({ ...formData, name: e.detail.value! })}
                    placeholder="z.B. Ausflug, Gottesdienst"
                    disabled={loading}
                    clearInput={true}
                  />
                </IonItem>
                <IonItem lines="none" style={{ '--background': 'transparent' }}>
                  <IonLabel position="stacked">Beschreibung</IonLabel>
                  <IonTextarea
                    value={formData.description}
                    onIonInput={(e) => setFormData({ ...formData, description: e.detail.value! })}
                    placeholder="Beschreibung der Kategorie..."
                    rows={3}
                    disabled={loading}
                  />
                </IonItem>
              </IonList>
            </IonCardContent>
          </IonCard>
        </IonList>
      </IonContent>
    </IonPage>
  );
};

const AdminCategoriesPage: React.FC = () => {
  const { pageRef, presentingElement, cleanupModals } = useModalPage('admin-categories');
  const { user, setSuccess, setError, isOnline } = useApp();

  // Offline-Query: Categories
  const { data: categories, loading, refresh: refreshCategories } = useOfflineQuery<Category[]>(
    'admin:categories:' + user?.organization_id,
    async () => { const res = await api.get('/admin/categories'); return res.data; },
    { ttl: CACHE_TTL.STAMMDATEN }
  );

  const [editCategory, setEditCategory] = useState<Category | null>(null);
  const slidingRefs = useRef<Map<number, HTMLIonItemSlidingElement>>(new Map());

  // Alert Hook für Bestätigungsdialoge
  const [presentAlert] = useIonAlert();

  // Modal mit useIonModal Hook
  const [presentCategoryModalHook, dismissCategoryModalHook] = useIonModal(CategoryModal, {
    category: editCategory,
    onClose: () => dismissCategoryModalHook(),
    onSuccess: () => {
      dismissCategoryModalHook();
      refreshCategories();
    }
  });

  // Subscribe to live updates for categories
  useLiveRefresh('categories', refreshCategories);

  const handleRefresh = async (event: CustomEvent) => {
    await refreshCategories();
    (event.target as HTMLIonRefresherElement).complete();
  };

  const handleDelete = async (category: Category) => {
    if (!isOnline) return;
    presentAlert({
      header: 'Kategorie löschen',
      message: `Kategorie "${category.name}" wirklich löschen?`,
      buttons: [
        { text: 'Abbrechen', role: 'cancel' },
        {
          text: 'Löschen',
          role: 'destructive',
          handler: async () => {
            const slidingElement = slidingRefs.current.get(category.id);
            try {
              await api.delete(`/admin/categories/${category.id}`);
              refreshCategories();
            } catch (error: any) {
              if (slidingElement) {
                await slidingElement.close();
              }
              const errorMessage = error.response?.data?.error || 'Fehler beim Löschen der Kategorie';
              setError(errorMessage);
            }
          }
        }
      ]
    });
  };

  const openCreateModal = () => {
    setEditCategory(null);
    presentCategoryModalHook({ presentingElement });
  };

  const openEditModal = (category: Category) => {
    setEditCategory(category);
    presentCategoryModalHook({ presentingElement });
  };

  // Rollen-basierte Berechtigungen (org_admin und admin dürfen alles)
  const isAdmin = ['org_admin', 'admin'].includes(user?.role_name || '');
  const canCreate = isAdmin;
  const canEdit = isAdmin;
  const canDelete = isAdmin;

  if (loading) {
    return (
      <IonPage ref={pageRef}>
        <IonHeader>
          <IonToolbar>
            <IonTitle>Kategorien</IonTitle>
          </IonToolbar>
        </IonHeader>
        <IonContent>
          <LoadingSpinner fullScreen message="Kategorien werden geladen..." />
        </IonContent>
      </IonPage>
    );
  }

  return (
    <IonPage ref={pageRef}>
      <IonHeader translucent={true}>
        <IonToolbar>
          <IonButtons slot="start">
            <IonButton onClick={() => window.history.back()}>
              <IonIcon icon={arrowBack} />
            </IonButton>
          </IonButtons>
          <IonTitle>Kategorien</IonTitle>
          {canCreate && (
            <IonButtons slot="end">
              <IonButton onClick={openCreateModal}>
                <IonIcon icon={add} />
              </IonButton>
            </IonButtons>
          )}
        </IonToolbar>
      </IonHeader>

      <IonContent className="app-gradient-background" fullscreen>
        <IonHeader collapse="condense">
          <IonToolbar className="app-condense-toolbar">
            <IonTitle size="large">Kategorien</IonTitle>
          </IonToolbar>
        </IonHeader>
        
        <IonRefresher slot="fixed" onIonRefresh={handleRefresh} onIonPull={triggerPullHaptic}>
          <IonRefresherContent refreshingSpinner="crescent" />
        </IonRefresher>

        <SectionHeader
          title="Kategorien"
          subtitle="Aktivitäten und Events"
          icon={pricetag}
          preset="categories"
          stats={[
            { value: (categories || []).length, label: 'GESAMT' }
          ]}
        />

        {/* Categories List */}
        <ListSection
          icon={pricetagOutline}
          title="Kategorien"
          count={(categories || []).length}
          iconColorClass="categories"
          emptyIcon={pricetag}
          emptyTitle="Keine Kategorien gefunden"
          emptyMessage="Noch keine Kategorien angelegt"
          emptyIconColor="#0ea5e9"
        >
                  {(categories || []).map((category, index) => (
                    <IonItemSliding
                      key={category.id}
                      ref={(el) => {
                        if (el) {
                          slidingRefs.current.set(category.id, el);
                        } else {
                          slidingRefs.current.delete(category.id);
                        }
                      }}
                      style={{ marginBottom: index < (categories || []).length - 1 ? '8px' : '0' }}
                    >
                      <IonItem
                        button={canEdit}
                        onClick={canEdit ? () => openEditModal(category) : undefined}
                        detail={false}
                        lines="none"
                        style={{
                          '--background': 'transparent',
                          '--padding-start': '0',
                          '--padding-end': '0',
                          '--inner-padding-end': '0',
                          '--inner-border-width': '0',
                          '--border-style': 'none',
                          '--min-height': 'auto'
                        }}
                      >
                        <div
                          className="app-list-item app-list-item--categories"
                          style={{ width: '100%' }}
                        >
                          <div className="app-list-item__row">
                            <div className="app-list-item__main">
                              <div className="app-icon-circle app-icon-circle--lg app-icon-circle--categories">
                                <IonIcon icon={pricetag} />
                              </div>
                              <div className="app-list-item__content">
                                <div className="app-list-item__title">
                                  {category.name}
                                </div>
                                {category.description && (
                                  <div className="app-list-item__meta">
                                    <span className="app-list-item__meta-item">
                                      {category.description}
                                    </span>
                                  </div>
                                )}
                              </div>
                            </div>
                          </div>
                        </div>
                      </IonItem>

                      {canDelete && (
                        <IonItemOptions side="end" className="app-swipe-actions">
                          <IonItemOption
                            onClick={() => handleDelete(category)}
                            className="app-swipe-action"
                          >
                            <div className="app-icon-circle app-icon-circle--lg app-icon-circle--danger">
                              <IonIcon icon={trash} />
                            </div>
                          </IonItemOption>
                        </IonItemOptions>
                      )}
                    </IonItemSliding>
                  ))}
        </ListSection>

      </IonContent>
    </IonPage>
  );
};

export default AdminCategoriesPage;