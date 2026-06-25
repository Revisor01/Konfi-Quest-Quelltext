import React, { useState, useEffect, useRef } from 'react';
import {
  IonHeader,
  IonToolbar,
  IonTitle,
  IonContent,
  IonPage,
  IonButtons,
  IonButton,
  IonItem,
  IonLabel,
  IonInput,
  IonToggle,
  IonCard,
  IonCardContent,
  IonIcon,
  IonList,
  IonListHeader,
  IonSpinner,
  useIonAlert
} from '@ionic/react';
import {
  closeOutline,
  checkmarkOutline,
  checkmarkCircle,
  personOutline,
  shieldOutline,
  schoolOutline,
  cloudOfflineOutline
} from 'ionicons/icons';
import { useApp } from '../../../contexts/AppContext';
import { useActionGuard } from '../../../hooks/useActionGuard';
import api from '../../../services/api';
import { AdminUser } from '../../../types/user';

interface Role {
  id: number;
  name: string;
  display_name: string;
  description?: string;
  is_system_role: boolean;
  is_active: boolean;
  user_count: number;
}

interface Jahrgang {
  id: number;
  name: string;
}

interface UserManagementModalProps {
  userId?: number | null;
  onClose: () => void;
  onSuccess: () => void;
}

const UserManagementModal: React.FC<UserManagementModalProps> = ({
  userId,
  onClose,
  onSuccess
}) => {
  const { setError, user: currentUser, isOnline } = useApp();
  const { isSubmitting, guard } = useActionGuard();
  const [loading, setLoading] = useState(false);
  const [isDirty, setIsDirty] = useState(false);
  const [presentAlert] = useIonAlert();
  const initializedRef = useRef(false);

  const doClose = () => onClose();

  const handleClose = () => {
    if (isDirty) {
      presentAlert({
        header: 'Ungespeicherte Änderungen',
        message: 'Möchtest du die Änderungen verwerfen?',
        buttons: [
          { text: 'Abbrechen', role: 'cancel' },
          { text: 'Verwerfen', role: 'destructive', handler: () => doClose() }
        ]
      });
    } else {
      doClose();
    }
  };

  // Form data
  const [formData, setFormData] = useState({
    username: '',
    email: '',
    display_name: '',
    role_title: '', // Funktionsbeschreibung z.B. "Pastor", "Diakonin"
    password: '',
    role_id: 0,
    is_active: true
  });

  // isDirty nach Initialisierung bei jeder formData-Änderung setzen
  useEffect(() => {
    if (initializedRef.current) {
      setIsDirty(true);
    }
  }, [formData]);

  // Available data
  const [roles, setRoles] = useState<Role[]>([]);
  const [jahrgaenge, setJahrgaenge] = useState<Jahrgang[]>([]);
  const [user, setUser] = useState<AdminUser | null>(null);

  // Jahrgang assignments
  const [jahrgangAssignments, setJahrgangAssignments] = useState<{ [key: number]: boolean }>({});

  const isEditMode = !!userId;

  // Hierarchie-Check: Kann der aktuelle User diese Rolle zuweisen?
  const canAssignRole = (roleName: string) => {
    const userRole = currentUser?.role_name;

    // Konfis werden über separate KonfiModal erstellt
    if (roleName === 'konfi') return false;

    if (userRole === 'org_admin') {
      return roleName !== 'konfi';
    } else if (userRole === 'admin') {
      return roleName !== 'org_admin' && roleName !== 'admin' && roleName !== 'konfi';
    }
    return false;
  };

  useEffect(() => {
    const init = async () => {
      await loadInitialData();
      if (isEditMode) {
        await loadUser();
      }
      setTimeout(() => { initializedRef.current = true; }, 100);
    };
    init();
  }, [userId]);

  const loadInitialData = async () => {
    setLoading(true);
    try {
      const [rolesResponse, jahrgaengeResponse] = await Promise.all([
        api.get('/roles'),
        api.get('/admin/jahrgaenge')
      ]);
      setRoles(rolesResponse.data);
      setJahrgaenge(jahrgaengeResponse.data);
    } catch (err) {
 console.error('Error loading initial data:', err);
      setError('Fehler beim Laden der Daten');
    } finally {
      if (!isEditMode) setLoading(false);
    }
  };

  const loadUser = async () => {
    if (!userId) return;

    setLoading(true);
    try {
      const response = await api.get(`/users/${userId}`);
      const userData = response.data;

      setUser(userData);
      setFormData({
        username: userData.username,
        email: userData.email || '',
        display_name: userData.display_name,
        role_title: userData.role_title || '',
        password: '',
        role_id: userData.role_id,
        is_active: userData.is_active
      });

      const assignments: { [key: number]: boolean } = {};
      if (userData.assigned_jahrgaenge) {
        userData.assigned_jahrgaenge.forEach((assignment: { id: number; name: string; can_view?: boolean; can_edit?: boolean; assigned_at?: string; assigned_by_name?: string }) => {
          assignments[assignment.id] = !!(assignment.can_view || assignment.can_edit);
        });
      }
      setJahrgangAssignments(assignments);
    } catch (err) {
      setError('Fehler beim Laden des Benutzers');
 console.error('Error loading user:', err);
    } finally {
      setLoading(false);
    }
  };

  const handleSave = async () => {
    if (!formData.username.trim() || !formData.display_name.trim() || !formData.role_id) {
      setError('Benutzername, Anzeigename und Rolle sind erforderlich');
      return;
    }

    if (!isEditMode && !formData.password.trim()) {
      setError('Passwort ist für neue Benutzer erforderlich');
      return;
    }

    await guard(async () => {
      try {
        const userData: any = {
          username: formData.username.trim(),
          email: formData.email.trim() || null,
          display_name: formData.display_name.trim(),
          role_title: formData.role_title.trim() || null,
          role_id: formData.role_id,
          is_active: formData.is_active
        };

        if (formData.password.trim()) {
          userData.password = formData.password;
        }

        let userIdForAssignments = userId;
        if (isEditMode) {
          await api.put(`/users/${userId}`, userData);
        } else {
          const response = await api.post('/users', userData);
          userIdForAssignments = response.data.id;
        }

        // Update jahrgang assignments
        const assignments = Object.entries(jahrgangAssignments)
          .filter(([_, isAssigned]) => isAssigned)
          .map(([jahrgangId, _]) => ({
            jahrgang_id: parseInt(jahrgangId),
            can_view: true,
            can_edit: true
          }));

        if (userIdForAssignments) {
          await api.post(`/users/${userIdForAssignments}/jahrgaenge`, {
            jahrgang_assignments: assignments
          });
        }

        setIsDirty(false);
        onSuccess();
      } catch (err: any) {
        setError(err.response?.data?.error || 'Fehler beim Speichern des Benutzers');
      }
    });
  };

  const handleJahrgangAssignment = (jahrgangId: number, value: boolean) => {
    setJahrgangAssignments(prev => ({
      ...prev,
      [jahrgangId]: value
    }));
  };

  const getSelectedRole = () => {
    return roles.find(role => role.id === formData.role_id);
  };

  const getAllowedRoles = () => {
    return roles.filter(role => canAssignRole(role.name));
  };

  const getRoleColor = (roleName: string) => {
    switch (roleName) {
      case 'org_admin': return '#667eea';
      case 'admin': return '#667eea';
      case 'teamer': return '#be185d';
      default: return '#6b7280';
    }
  };

  const getRoleDisplayName = (roleName: string) => {
    switch (roleName) {
      case 'org_admin': return 'Org-Admin';
      case 'admin': return 'Admin';
      case 'teamer': return 'Teamer:in';
      default: return roleName;
    }
  };

  // Klare Beschreibung je Rolle (unabhaengig vom technischen DB-Text).
  const getRoleDescription = (roleName: string) => {
    switch (roleName) {
      case 'org_admin': return 'Voller Zugriff auf Konfis, Anträge, Aktivitäten, Badges und Events – über alle Jahrgänge. Verwaltet zusätzlich die Benutzer:innen und deren Jahrgangs-Zuordnung.';
      case 'admin': return 'Voller Zugriff auf Konfis, Anträge, Aktivitäten, Badges und Events – nur für die zugewiesenen Jahrgänge.';
      case 'teamer': return 'Eigenes Dashboard mit eigenen Badges, Team-Material und Team-Chat. Kann sich zu Events anmelden, bei denen Teamer:innen gebraucht werden. Vergibt keine Punkte und genehmigt keine Anträge.';
      default: return '';
    }
  };

  const isValid = formData.username.trim() && formData.display_name.trim() && formData.role_id > 0;

  if (loading) {
    return (
      <IonPage>
        <IonHeader>
          <IonToolbar>
            <IonTitle>{isEditMode ? 'Benutzer bearbeiten' : 'Neuer Benutzer'}</IonTitle>
            <IonButtons slot="start">
              <IonButton onClick={handleClose} className="app-modal-close-btn">
                <IonIcon icon={closeOutline} />
              </IonButton>
            </IonButtons>
          </IonToolbar>
        </IonHeader>
        <IonContent className="ion-padding">
          <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '200px' }}>
            <IonSpinner name="crescent" />
          </div>
        </IonContent>
      </IonPage>
    );
  }

  return (
    <IonPage>
      <IonHeader>
        <IonToolbar>
          <IonTitle>{isEditMode ? 'Benutzer bearbeiten' : 'Neuer Benutzer'}</IonTitle>
          <IonButtons slot="start">
            <IonButton onClick={onClose} disabled={isSubmitting} className="app-modal-close-btn">
              <IonIcon icon={closeOutline} />
            </IonButton>
          </IonButtons>
          <IonButtons slot="end">
            <IonButton onClick={handleSave} disabled={!isValid || isSubmitting || !isOnline} className="app-modal-submit-btn app-modal-submit-btn--settings">
              {!isOnline ? <><IonIcon icon={cloudOfflineOutline} /> Du bist offline</> : isSubmitting ? <IonSpinner name="crescent" /> : <IonIcon icon={checkmarkOutline} />}
            </IonButton>
          </IonButtons>
        </IonToolbar>
      </IonHeader>

      <IonContent className="app-gradient-background">
        {/* SEKTION: Persönliche Daten */}
        <IonList inset={true} className="app-modal-section">
          <IonListHeader>
            <div className="app-section-icon app-section-icon--users">
              <IonIcon icon={personOutline} />
            </div>
            <IonLabel>Persönliche Daten</IonLabel>
          </IonListHeader>
          <IonCard className="app-card">
            <IonCardContent>
              <div style={{ display: 'flex', flexDirection: 'column' }}>
                <IonItem lines="full" style={{ '--background': 'transparent' }}>
                  <IonLabel position="stacked">Anzeigename *</IonLabel>
                  <IonInput
                    value={formData.display_name}
                    onIonInput={(e) => setFormData({ ...formData, display_name: e.detail.value! })}
                    placeholder="Max Mustermann"
                    disabled={isSubmitting}
                  />
                </IonItem>

                <IonItem lines="full" style={{ '--background': 'transparent' }}>
                  <IonLabel position="stacked">Benutzername *</IonLabel>
                  <IonInput
                    value={formData.username}
                    onIonInput={(e) => setFormData({ ...formData, username: e.detail.value! })}
                    placeholder="max.mustermann"
                    disabled={isSubmitting}
                  />
                </IonItem>

                <IonItem lines="full" style={{ '--background': 'transparent' }}>
                  <IonLabel position="stacked">Funktionsbeschreibung (optional)</IonLabel>
                  <IonInput
                    value={formData.role_title}
                    onIonInput={(e) => setFormData({ ...formData, role_title: e.detail.value! })}
                    placeholder="z.B. Pastor, Diakonin, Jugendmitarbeiter"
                    disabled={isSubmitting}
                  />
                </IonItem>

                <IonItem lines="full" style={{ '--background': 'transparent' }}>
                  <IonLabel position="stacked">E-Mail (optional)</IonLabel>
                  <IonInput
                    type="email"
                    value={formData.email}
                    onIonInput={(e) => setFormData({ ...formData, email: e.detail.value! })}
                    placeholder="max@example.com"
                    disabled={isSubmitting}
                  />
                </IonItem>

                <IonItem lines="none" style={{ '--background': 'transparent' }}>
                  <IonLabel position="stacked">
                    Passwort {!isEditMode && <span style={{ color: '#ef4444' }}>*</span>}
                  </IonLabel>
                  <IonInput
                    type="password"
                    value={formData.password}
                    onIonInput={(e) => setFormData({ ...formData, password: e.detail.value! })}
                    placeholder={isEditMode ? "Leer lassen um nicht zu ändern" : "Passwort eingeben"}
                    disabled={isSubmitting}
                  />
                </IonItem>
              </div>
            </IonCardContent>
          </IonCard>
        </IonList>

        {/* SEKTION: Rolle und Status */}
        <IonList inset={true} className="app-modal-section">
          <IonListHeader>
            <div className="app-section-icon app-section-icon--users">
              <IonIcon icon={shieldOutline} />
            </div>
            <IonLabel>Rolle & Status</IonLabel>
          </IonListHeader>
          <IonCard className="app-card">
            <IonCardContent style={{ padding: '16px 16px 8px 16px' }}>
              {/* Rolle - klickbare Liste */}
              <div style={{ marginBottom: '16px' }}>
                <IonLabel style={{ fontSize: '0.85rem', color: '#666', marginBottom: '8px', display: 'block' }}>
                  Rolle *
                </IonLabel>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                  {getAllowedRoles().map(role => {
                    const isSelected = formData.role_id === role.id;
                    const roleColor = getRoleColor(role.name);

                    return (
                      <div
                        key={role.id}
                        className="app-list-item"
                        onClick={() => !isSubmitting && setFormData({ ...formData, role_id: role.id })}
                        style={{
                          cursor: isSubmitting ? 'default' : 'pointer',
                          opacity: isSubmitting ? 0.6 : 1,
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'space-between',
                          marginBottom: '0',
                          borderLeftColor: roleColor,
                          background: isSelected ? `${roleColor}15` : undefined
                        }}
                      >
                        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                          <div
                            className="app-icon-circle"
                            style={{ backgroundColor: roleColor, width: '32px', height: '32px' }}
                          >
                            <IonIcon icon={shieldOutline} style={{ fontSize: '0.9rem' }} />
                          </div>
                          <div>
                            <span style={{ fontWeight: '500', color: '#333', display: 'block' }}>
                              {getRoleDisplayName(role.name)}
                            </span>
                            {getRoleDescription(role.name) && (
                              <span style={{ fontSize: '0.75rem', color: '#8e8e93', display: 'block', marginTop: '2px', lineHeight: 1.35 }}>
                                {getRoleDescription(role.name)}
                              </span>
                            )}
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Konto aktiv Toggle */}
              <div style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                padding: '12px 0',
                borderTop: '1px solid rgba(0,0,0,0.06)'
              }}>
                <div>
                  <h3 style={{ fontWeight: '500', margin: '0 0 4px 0', fontSize: '0.95rem' }}>Konto aktiv</h3>
                  <p style={{ color: '#666', margin: 0, fontSize: '0.8rem' }}>
                    Benutzer kann sich anmelden
                  </p>
                </div>
                <IonToggle
                  className="app-toggle--users"
                  checked={formData.is_active}
                  onIonChange={(e) => setFormData({ ...formData, is_active: e.detail.checked })}
                  disabled={isSubmitting}
                />
              </div>
            </IonCardContent>
          </IonCard>
        </IonList>

        {/* SEKTION: Jahrgang-Zuweisungen */}
        <IonList inset={true} className="app-modal-section">
          <IonListHeader>
            <div className="app-section-icon app-section-icon--users">
              <IonIcon icon={schoolOutline} />
            </div>
            <IonLabel>Jahrgang-Zuweisungen</IonLabel>
          </IonListHeader>
          <IonCard className="app-card">
            <IonCardContent style={{ padding: '16px' }}>
            {jahrgaenge.length === 0 ? (
              <IonItem lines="none" style={{ '--background': 'transparent' }}>
                <IonLabel style={{ textAlign: 'center' }}>
                  <p style={{ color: '#999', margin: 0 }}>Keine Jahrgänge verfügbar</p>
                </IonLabel>
              </IonItem>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column' }}>
                {jahrgaenge.map((jahrgang, index) => {
                  const isAssigned = jahrgangAssignments[jahrgang.id] || false;

                  return (
                    <div
                      key={jahrgang.id}
                      className="app-list-item app-list-item--users"
                      onClick={() => !isSubmitting && handleJahrgangAssignment(jahrgang.id, !isAssigned)}
                      style={{
                        cursor: isSubmitting ? 'default' : 'pointer',
                        opacity: isSubmitting ? 0.6 : 1,
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        marginBottom: index < jahrgaenge.length - 1 ? '8px' : '0',
                        background: isAssigned ? 'rgba(102, 126, 234, 0.08)' : undefined
                      }}
                    >
                      <span style={{ fontWeight: '500', color: '#333' }}>{jahrgang.name}</span>
                    </div>
                  );
                })}
              </div>
            )}
          </IonCardContent>
        </IonCard>

        </IonList>

        {/* Bestehende Zuweisungen im Edit-Modus - als eigene Sektion */}
        {isEditMode && user?.assigned_jahrgaenge && user.assigned_jahrgaenge.length > 0 && (
          <IonList inset={true} className="app-modal-section">
            <IonListHeader>
              <div className="app-section-icon app-section-icon--users">
                <IonIcon icon={checkmarkCircle} />
              </div>
              <IonLabel>Aktuelle Zuweisungen</IonLabel>
            </IonListHeader>
            <IonCard className="app-card">
              <IonCardContent style={{ padding: '16px' }}>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                  {user.assigned_jahrgaenge.map(assignment => (
                    <div
                      key={assignment.id}
                      className="app-list-item app-list-item--users"
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: '10px'
                      }}
                    >
                      <IonIcon icon={checkmarkCircle} style={{ color: '#667eea', fontSize: '1.1rem', flexShrink: 0 }} />
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <span style={{ fontWeight: '500', fontSize: '0.9rem', color: '#333', display: 'block' }}>
                          {assignment.name}
                        </span>
                        <span style={{ fontSize: '0.75rem', color: '#8e8e93' }}>
                          {assignment.assigned_at && new Date(assignment.assigned_at).toLocaleDateString('de-DE')}
                          {assignment.assigned_by_name && ` von ${assignment.assigned_by_name}`}
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              </IonCardContent>
            </IonCard>
          </IonList>
        )}
      </IonContent>
    </IonPage>
  );
};

export default UserManagementModal;
