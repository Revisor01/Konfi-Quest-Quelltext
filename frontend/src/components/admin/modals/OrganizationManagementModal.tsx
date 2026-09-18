import { fehlerText } from '../../../utils/fehler';
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
  IonTextarea,
  IonSelect,
  IonSelectOption,
  IonDatetime,
  IonDatetimeButton,
  IonModal,
  IonNote,
  IonItemSliding,
  IonItemOptions,
  IonItemOption,
  useIonAlert,
  useIonModal
} from '@ionic/react';
import {
  ICON_BEARBEITEN,
  ICON_FUNKELN,
  ICON_GRUPPE,
  ICON_GRUPPE_GEFUELLT,
  ICON_HAKEN,
  ICON_HINZUFUEGEN_GEFUELLT,
  ICON_LOESCHEN_GEFUELLT,
  ICON_MAIL,
  ICON_OFFLINE,
  ICON_ORGANISATION,
  ICON_ORT,
  ICON_PERSON,
  ICON_PERSON_HINZUFUEGEN,
  ICON_PLUS_KREIS,
  ICON_SCHILD,
  ICON_SCHLIESSEN,
  ICON_SICHTBAR,
  ICON_SUCHE,
  ICON_TELEFON,
  ICON_TERMIN,
  ICON_TEXTDOKUMENT,
  ICON_UHRZEIT,
  ICON_VERBORGEN,
  ICON_WARNHINWEIS,
  ICON_WELT,
} from '../../shared/icons';
import { SectionHeader } from '../../shared';
import { useApp } from '../../../contexts/AppContext';
import { useActionGuard } from '../../../hooks/useActionGuard';
import api from '../../../services/api';
import AdminPasswordResetModal from './AdminPasswordResetModal';
import { closeOpenSlidingItems } from '../../../utils/slidingItems';
import { generateStrongPassword } from '../../../utils/passwortVorschlag';
import { tageBis } from '../../shared/eventFormatting';

interface Organization {
  id: number;
  name: string;
  slug: string;
  display_name: string;
  description?: string;
  contact_name?: string;
  contact_email?: string;
  contact_phone?: string;
  address?: string;
  website_url?: string;
  kirchenkreis?: string;
  trial_ends_at?: string | null;
  is_trial?: boolean;
  is_active: boolean;
  created_at: string;
  updated_at: string;
  user_count: number;
  teamer_count: number;
  admin_count: number;
  konfi_count: number;
  event_count: number;
  max_konfis?: number | null;
}

interface OrgAdmin {
  id: number;
  username: string;
  display_name: string;
  email?: string;
  is_active: boolean;
}

// Multi-Org-Mitglieder (bestehende User, die dieser Org zugewiesen sind)
interface OrgMember {
  id: number;
  username: string;
  display_name: string;
  email?: string;
  role_name: string;
  role_display_name?: string;
  is_primary: boolean;
}

interface MemberSearchResult {
  id: number;
  username: string;
  display_name: string;
  email?: string;
  primary_organization_name?: string;
  primary_role_name?: string;
}

const MEMBER_ROLE_OPTIONS = [
  { value: 'org_admin', label: 'Org-Admin' },
  { value: 'admin', label: 'Admin' },
  { value: 'teamer', label: 'Teamer:in' }
];

interface OrganizationManagementModalProps {
  organizationId?: number | null;
  onClose: () => void;
  onSuccess: () => void;
}

// Tarif-Stufen wie auf der Website (landing.html / marketing-copy.md).
// value als String für direkten Vergleich mit dem maxKonfis-Feld; '' = unbegrenzt.
const KONFI_TARIFE: { label: string; value: string }[] = [
  { label: 'Klein', value: '15' },
  { label: 'Standard', value: '50' },
  { label: 'Plus', value: '75' },
  { label: 'Groß', value: '100' },
  { label: 'Unbegrenzt', value: '' }
];

// Zeitraum-Schnellauswahl: Tage ab heute (0 = unbegrenzt, -1 = eigenes Datum)
const ZEITRAUM_OPTIONEN: { label: string; days: number }[] = [
  { label: '30 Tage (Testphase)', days: 30 },
  { label: '1 Jahr (365 Tage)', days: 365 },
  { label: 'Unbegrenzt', days: 0 },
  { label: 'Eigenes Datum…', days: -1 }
];

const OrganizationManagementModal: React.FC<OrganizationManagementModalProps> = ({
  organizationId,
  onClose,
  onSuccess
}) => {
  const { setError, isOnline, user } = useApp();
  // Super-Admin ist das Flag is_super_admin (org_admins können es zusaetzlich haben),
  // NICHT role_name==='super_admin' — sonst sieht ein org_admin mit Flag die Limit-Sektion nie.
  const isSuperAdmin = user?.is_super_admin === true || user?.role_name === 'super_admin';
  const { isSubmitting, guard } = useActionGuard();
  const [loading, setLoading] = useState(false);
  const [isDirty, setIsDirty] = useState(false);
  const [presentAlert] = useIonAlert();
  const initializedRef = useRef(false);
  // Ref auf die IonPage dieses Modals — dient dem verschachtelten Passwort-Modal
  // als presentingElement, damit iOS den korrekten Card-Backdrop rendert.
  const pageRef = useRef<HTMLElement | null>(null);

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

  // Form data - Systemname wird automatisch generiert
  const [formData, setFormData] = useState({
    display_name: '',
    description: '',
    contact_name: '',
    contact_email: '',
    contact_phone: '',
    address: '',
    website_url: '',
    kirchenkreis: '',
    is_active: true,
    // Admin-Daten für neue Organisation
    admin_name: '',        // Anzeigename des Admins (z.B. "Pastor Müller")
    admin_username: '',    // Login-Name (z.B. "pmueller")
    admin_password: ''
  });

  // isDirty nach Initialisierung bei jeder formData-Änderung setzen
  useEffect(() => {
    if (initializedRef.current) {
      setIsDirty(true);
    }
  }, [formData]);

  const [organization, setOrganization] = useState<Organization | null>(null);
  // Konfi-Limit (nur für super_admin sichtbar/setzbar). Leeres Feld = unbegrenzt (NULL).
  // Wird zusammen mit dem Modal gespeichert (kein separater Button).
  const [maxKonfis, setMaxKonfis] = useState<string>('');
  // "Eigenes Limit"-Modus: Zahlenfeld statt Tarif-Auswahl
  const [isCustomLimit, setIsCustomLimit] = useState(false);
  // Zeitraum-Enddatum (ISO-String) oder '' = unbegrenzt (nur super_admin)
  const [trialEndsAt, setTrialEndsAt] = useState<string>('');
  // is_trial: true = Testphase (Dashboard-Hinweis), false = Lizenz/unbegrenzt (kein Hinweis)
  const [isTrial, setIsTrial] = useState<boolean>(false);
  // "Eigenes Datum"-Modus für den Zeitraum (Datepicker statt Schnellauswahl)
  const [isCustomTrialDate, setIsCustomTrialDate] = useState<boolean>(false);

  const handleTrialChange = (value: string) => {
    setTrialEndsAt(value);
    if (initializedRef.current) setIsDirty(true);
  };

  const handleIsTrialChange = (value: boolean) => {
    setIsTrial(value);
    if (initializedRef.current) setIsDirty(true);
  };
  // Passwort des ersten Admins sichtbar machen — ein Vorschlag, den niemand
  // lesen kann, laesst sich auch nicht weitergeben.
  const [showAdminPassword, setShowAdminPassword] = useState(false);

  const handleAdminPasswordVorschlag = () => {
    setFormData(prev => ({ ...prev, admin_password: generateStrongPassword() }));
    setShowAdminPassword(true);
  };

  const [orgAdmins, setOrgAdmins] = useState<OrgAdmin[]>([]);
  const [showAddAdmin, setShowAddAdmin] = useState(false);
  const [newAdminData, setNewAdminData] = useState({ display_name: '', username: '', password: '' });
  const [addingAdmin, setAddingAdmin] = useState(false);
  // Welcher Admin wird im Passwort-Modal bearbeitet
  const [passwordAdmin, setPasswordAdmin] = useState<OrgAdmin | null>(null);

  // Multi-Org-Mitglieder (nur super_admin): bestehende User dieser Org zuweisen/entziehen
  const [members, setMembers] = useState<OrgMember[]>([]);
  const [membersLoading, setMembersLoading] = useState(false);
  const [memberSearch, setMemberSearch] = useState('');
  const [memberSearchResults, setMemberSearchResults] = useState<MemberSearchResult[]>([]);
  const [memberSearching, setMemberSearching] = useState(false);
  const [memberRole, setMemberRole] = useState<string>('teamer');
  const [memberAddingId, setMemberAddingId] = useState<number | null>(null);

  const isEditMode = !!organizationId;

  // View/Edit-Modus: bestehende Org startet als read-only Übersicht ('view'),
  // neue Org direkt im Formular ('edit'). Bearbeiten-Button oben wechselt um.
  const [viewMode, setViewMode] = useState<'view' | 'edit'>(organizationId ? 'view' : 'edit');

  // Neue Org: Default 30-Tage-Testphase vorbelegen (super_admin kann es ändern)
  useEffect(() => {
    if (!organizationId) {
      setTrialEndsAt(new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString());
      setIsTrial(true);
      setIsCustomTrialDate(false);
    }
  }, [organizationId]);

  // maxKonfis-Änderung markiert das Modal als dirty (aktiviert Speichern-Button)
  const handleMaxKonfisChange = (value: string) => {
    setMaxKonfis(value);
    if (initializedRef.current) setIsDirty(true);
  };

  // Passwort-Ändern-Modal (useIonModal, Konventions-Muster)
  const [presentPasswordModal, dismissPasswordModal] = useIonModal(AdminPasswordResetModal, {
    adminId: passwordAdmin?.id ?? 0,
    adminName: passwordAdmin?.display_name ?? '',
    onClose: () => dismissPasswordModal(),
    onSuccess: () => dismissPasswordModal()
  });

  // Initialen berechnen
  const getInitials = (name: string) => {
    return name
      .split(' ')
      .map(n => n.charAt(0))
      .join('')
      .toUpperCase()
      .substring(0, 2);
  };

  // Systemname automatisch aus display_name generieren
  const generateSystemName = (displayName: string) => {
    return displayName
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, '')
      .replace(/\s+/g, '-')
      .replace(/-+/g, '-')
      .replace(/^-|-$/g, '');
  };

  useEffect(() => {
    if (isEditMode) {
      loadOrganization().then(() => {
        setTimeout(() => { initializedRef.current = true; }, 100);
      });
    } else {
      setTimeout(() => { initializedRef.current = true; }, 100);
    }
  }, [organizationId]);

  const loadOrganization = async () => {
    if (!organizationId) return;

    setLoading(true);
    try {
      const response = await api.get(`/organizations/${organizationId}`);
      const orgData = response.data;

      setOrganization(orgData);
      const loadedLimit = orgData.max_konfis !== null && orgData.max_konfis !== undefined ? String(orgData.max_konfis) : '';
      setMaxKonfis(loadedLimit);
      // Wenn der geladene Wert keinem Tarif entspricht (und nicht leer/unbegrenzt ist), ist es ein eigenes Limit
      setIsCustomLimit(loadedLimit !== '' && !KONFI_TARIFE.some(t => t.value === loadedLimit));
      setTrialEndsAt(orgData.trial_ends_at || '');
      setIsTrial(orgData.is_trial === true);
      // Wenn ein Datum gesetzt ist, das keiner Schnellauswahl entspricht -> "eigenes Datum"
      setIsCustomTrialDate(!!orgData.trial_ends_at);
      setFormData({
        display_name: orgData.display_name || '',
        description: orgData.description || '',
        contact_name: orgData.contact_name || '',
        contact_email: orgData.contact_email || '',
        contact_phone: orgData.contact_phone || '',
        address: orgData.address || '',
        website_url: orgData.website_url || '',
        kirchenkreis: orgData.kirchenkreis || '',
        is_active: orgData.is_active !== undefined ? orgData.is_active : true,
        admin_name: '',
        admin_username: '',
        admin_password: ''
      });

      // Org-Admins laden
      try {
        const usersResponse = await api.get(`/organizations/${organizationId}/admins`);
        if (usersResponse.data) {
          setOrgAdmins(usersResponse.data);
        }
      } catch (err) {
 console.warn('Org-Admins konnten nicht geladen werden:', err);
      }

      // Multi-Org-Mitglieder laden (nur super_admin sieht/braucht die Sektion)
      if (isSuperAdmin) {
        loadMembers();
      }
    } catch (err) {
      setError('Fehler beim Laden der Organisation');
 console.error('Error loading organization:', err);
    } finally {
      setLoading(false);
    }
  };

  const handleSave = async () => {
    if (!formData.display_name.trim()) {
      setError('Name der Organisation ist erforderlich');
      return;
    }

    // Validate admin fields for new organizations
    if (!isEditMode) {
      if (!formData.admin_name.trim() || !formData.admin_username.trim() || !formData.admin_password.trim()) {
        setError('Alle Administrator-Felder sind erforderlich');
        return;
      }
      // Dieselbe Policy wie ueberall sonst: Hier galten
      // bisher nur 6 Zeichen, obwohl der Server inzwischen die volle Policy
      // erzwingt — ohne diese Prüfung kaeme die Ablehnung erst vom Server.
      const pw = formData.admin_password;
      const passwortFehler =
        pw.length < 8 ? 'Das Passwort muss mindestens 8 Zeichen lang sein'
        : /\s/.test(pw) ? 'Das Passwort darf keine Leerzeichen enthalten'
        : !/[A-Z]/.test(pw) ? 'Das Passwort muss einen Großbuchstaben enthalten'
        : !/[a-z]/.test(pw) ? 'Das Passwort muss einen Kleinbuchstaben enthalten'
        : !/[0-9]/.test(pw) ? 'Das Passwort muss eine Zahl enthalten'
        : !/[!@#$%^&*(),.?":{}|<>_\-+=[\]\\/~`]/.test(pw) ? 'Das Passwort muss ein Sonderzeichen enthalten'
        : null;

      if (passwortFehler) {
        setError(passwortFehler);
        return;
      }
    }

    // Validate email format if provided
    if (formData.contact_email.trim()) {
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (!emailRegex.test(formData.contact_email.trim())) {
        setError('Ungültige E-Mail-Adresse');
        return;
      }
    }

    await guard(async () => {
      try {
        const systemName = generateSystemName(formData.display_name);

        // Konfi-Limit (Tarif) — nur super_admin setzt es. NULL = unbegrenzt.
        let limitValue: number | null = null;
        if (isSuperAdmin) {
          const trimmed = maxKonfis.trim();
          if (trimmed !== '') {
            const parsed = parseInt(trimmed, 10);
            if (isNaN(parsed) || parsed < 0) {
              setError('Das Konfi-Limit muss eine Zahl ab 0 oder leer sein');
              return;
            }
            limitValue = parsed;
          }
        }

        // Die optionalen Felder kommen erst weiter unten dazu: Testphase und
        // Konfi-Limit nur fuer super_admin, die Admin-Zugangsdaten nur beim
        // Anlegen einer neuen Organisation.
        const orgData: {
          name: string;
          slug: string;
          display_name: string;
          description: string | null;
          contact_name: string | null;
          contact_email: string | null;
          contact_phone: string | null;
          address: string | null;
          website_url: string | null;
          kirchenkreis: string | null;
          is_active: boolean;
          trial_ends_at?: string | null;
          is_trial?: boolean;
          max_konfis?: number | null;
          admin_username?: string;
          admin_password?: string;
          admin_display_name?: string;
        } = {
          name: systemName,
          slug: systemName,
          display_name: formData.display_name.trim(),
          description: formData.description.trim() || null,
          contact_name: formData.contact_name.trim() || null,
          contact_email: formData.contact_email.trim() || null,
          contact_phone: formData.contact_phone.trim() || null,
          address: formData.address.trim() || null,
          website_url: formData.website_url.trim() || null,
          kirchenkreis: formData.kirchenkreis.trim() || null,
          is_active: formData.is_active
        };

        // Zeitraum + Trial-Kennzeichnung nur super_admin.
        // Kein Datum -> unbegrenzt, dann ist es auch keine Testphase (is_trial=false).
        if (isSuperAdmin) {
          const endDate = trialEndsAt.trim() || null;
          orgData.trial_ends_at = endDate;
          orgData.is_trial = endDate ? isTrial : false;
        }

        if (!isEditMode) {
          orgData.admin_username = formData.admin_username.trim();
          orgData.admin_password = formData.admin_password.trim();
          orgData.admin_display_name = formData.admin_name.trim();
          // Limit direkt bei der Erstellung mitgeben (super_admin)
          if (isSuperAdmin) orgData.max_konfis = limitValue;
        }

        if (isEditMode) {
          await api.put(`/organizations/${organizationId}`, orgData);

          // Konfi-Limit wird zusammen mit dem Modal gespeichert (eigener Endpunkt).
          if (isSuperAdmin) {
            await api.patch(`/organizations/${organizationId}/limit`, { max_konfis: limitValue });
          }

        } else {
          await api.post('/organizations', orgData);
        }

        setIsDirty(false);
        onSuccess();
      } catch (err) {
        setError(fehlerText(err, 'Fehler beim Speichern'));
      }
    });
  };

  // Passwort ändern als eigenes Modal (useIonModal — Konventions-Muster mit
  // Anforderungs-Anzeige, Augen-Toggle und Vorschlag-Funktion).
  const openPasswordModal = (admin: OrgAdmin) => {
    if (!isOnline) {
      setError('Diese Aktion ist offline nicht möglich');
      return;
    }
    setPasswordAdmin(admin);
    // pageRef = IonPage dieses Modals -> iOS rendert den korrekten Card-Backdrop
    presentPasswordModal({ presentingElement: pageRef.current ?? undefined });
  };

  const handleAddAdmin = async () => {
    if (!newAdminData.display_name.trim() || !newAdminData.username.trim() || !newAdminData.password.trim()) {
      setError('Alle Felder sind erforderlich');
      return;
    }

    if (newAdminData.password.length < 8) {
      setError('Das Passwort muss mindestens 8 Zeichen lang sein');
      return;
    }

    setAddingAdmin(true);
    try {
      const response = await api.post(`/organizations/${organizationId}/admins`, newAdminData);
      setOrgAdmins([...orgAdmins, response.data]);
      setNewAdminData({ display_name: '', username: '', password: '' });
      setShowAddAdmin(false);
    } catch (err) {
      setError(fehlerText(err, 'Fehler beim Hinzufügen des Administrators'));
    } finally {
      setAddingAdmin(false);
    }
  };

  // ===== Multi-Org-Mitglieder =====
  const loadMembers = async () => {
    if (!organizationId) return;
    setMembersLoading(true);
    try {
      const res = await api.get(`/organizations/${organizationId}/members`);
      setMembers(Array.isArray(res.data) ? res.data : []);
    } catch {
      // still: Sektion zeigt dann "keine Mitglieder"; kein Stoer-Toast nötig
      setMembers([]);
    } finally {
      setMembersLoading(false);
    }
  };

  // Suche (debounced) — ab 2 Zeichen
  useEffect(() => {
    if (!isSuperAdmin || !isEditMode) return;
    const q = memberSearch.trim();
    if (q.length < 2) {
      setMemberSearchResults([]);
      return;
    }
    setMemberSearching(true);
    const handle = setTimeout(async () => {
      try {
        const res = await api.get(`/organizations/search-users`, { params: { q } });
        setMemberSearchResults(Array.isArray(res.data) ? res.data : []);
      } catch {
        setMemberSearchResults([]);
      } finally {
        setMemberSearching(false);
      }
    }, 350);
    return () => clearTimeout(handle);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [memberSearch]);

  const handleAddMember = async (userId: number) => {
    if (!organizationId) return;
    setMemberAddingId(userId);
    try {
      await api.post(`/organizations/${organizationId}/members`, {
        user_id: userId,
        role_name: memberRole
      });
      setMemberSearch('');
      setMemberSearchResults([]);
      await loadMembers();
    } catch (err) {
      setError(fehlerText(err, 'Mitglied konnte nicht hinzugefügt werden'));
    } finally {
      setMemberAddingId(null);
    }
  };

  const handleRemoveMember = async (member: OrgMember) => {
    if (!organizationId) return;
    try {
      await api.delete(`/organizations/${organizationId}/members/${member.id}`);
      await loadMembers();
    } catch (err) {
      setError(fehlerText(err, 'Mitglied konnte nicht entfernt werden'));
    }
  };

  // Schon-Mitglieder in der Suche ausblenden
  const memberIds = new Set(members.map(m => m.id));

  const isValid = formData.display_name.trim() &&
    (isEditMode || (formData.admin_name.trim() && formData.admin_username.trim() && formData.admin_password.trim()));

  if (loading) {
    return (
      <IonPage>
        <IonHeader>
          <IonToolbar>
            <IonTitle>{isEditMode ? 'Organisation bearbeiten' : 'Neue Organisation'}</IonTitle>
            <IonButtons slot="start">
              <IonButton aria-label="Schließen" onClick={handleClose} className="app-modal-close-btn"><IonIcon icon={ICON_SCHLIESSEN} /></IonButton>
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
    <IonPage ref={pageRef}>
      <IonHeader>
        <IonToolbar>
          <IonTitle>{!isEditMode ? 'Neue Organisation' : viewMode === 'view' ? 'Organisation' : 'Organisation bearbeiten'}</IonTitle>
          <IonButtons slot="start">
            <IonButton aria-label="Schließen" onClick={onClose} disabled={isSubmitting} className="app-modal-close-btn"><IonIcon icon={ICON_SCHLIESSEN} /></IonButton>
          </IonButtons>
          <IonButtons slot="end">
            {isEditMode && viewMode === 'view' ? (
              <IonButton aria-label="Organisation bearbeiten" onClick={() => setViewMode('edit')} className="app-modal-submit-btn app-modal-submit-btn--settings">
                <IonIcon icon={ICON_BEARBEITEN} />
              </IonButton>
            ) : (
              <IonButton aria-label="Organisation speichern" onClick={handleSave} disabled={!isValid || isSubmitting || !isOnline} className="app-modal-submit-btn app-modal-submit-btn--settings">
                {!isOnline ? <><IonIcon icon={ICON_OFFLINE} /> Du bist offline</> : isSubmitting ? <IonSpinner name="crescent" /> : <IonIcon icon={ICON_HAKEN} />}
              </IonButton>
            )}
          </IonButtons>
        </IonToolbar>
      </IonHeader>

      <IonContent className="app-gradient-background">
        {/* VIEW-MODUS: alle Infos der Organisation auf einen Blick (read-only) */}
        {isEditMode && viewMode === 'view' && organization && (
          <>
            <SectionHeader
              title={organization.display_name}
              subtitle={organization.kirchenkreis || 'Organisation'}
              icon={ICON_ORGANISATION}
              preset="organizations"
              stats={[
                { value: organization.konfi_count || 0, label: 'Konfis' },
                { value: organization.teamer_count || 0, label: 'Team' },
                { value: organization.admin_count || 0, label: 'Admins' }
              ]}
            />

            {/* INFO-CARD: alle Org-Infos (Stil wie EventInfoCard) */}
            <IonList className="app-section-inset" inset={true}>
              <IonListHeader>
                <div className="app-section-icon app-section-icon--organizations">
                  <IonIcon icon={ICON_ORGANISATION} />
                </div>
                <IonLabel>Informationen</IonLabel>
              </IonListHeader>
              <IonCard className="app-card">
                <IonCardContent className="app-card-content">
                  {organization.description && (
                    <div className="app-info-row">
                      <IonIcon icon={ICON_TEXTDOKUMENT} className="app-info-row__icon" style={{ color: 'var(--app-color-users)' }} />
                      <div>
                        <div className="app-info-row__label">Beschreibung</div>
                        <div className="app-info-row__value">{organization.description}</div>
                      </div>
                    </div>
                  )}

                  <div className="app-info-row">
                    <IonIcon icon={ICON_GRUPPE_GEFUELLT} className="app-info-row__icon" style={{ color: 'var(--app-color-users)' }} />
                    <div>
                      <div className="app-info-row__label">Konfis</div>
                      <div className="app-info-row__value">
                        {maxKonfis
                          ? `${organization.konfi_count} / ${maxKonfis} Konfis`
                          : `${organization.konfi_count} Konfis (unbegrenzt)`}
                      </div>
                    </div>
                  </div>

                  {organization.contact_name && (
                    <div className="app-info-row">
                      <IonIcon icon={ICON_PERSON} className="app-info-row__icon" style={{ color: 'var(--app-color-users)' }} />
                      <div>
                        <div className="app-info-row__label">Ansprechpartner:in</div>
                        <div className="app-info-row__value">{organization.contact_name}</div>
                      </div>
                    </div>
                  )}

                  {organization.contact_email && (
                    <div className="app-info-row">
                      <IonIcon icon={ICON_MAIL} className="app-info-row__icon" style={{ color: 'var(--app-color-users)' }} />
                      <div>
                        <div className="app-info-row__label">E-Mail</div>
                        <div className="app-info-row__value">{organization.contact_email}</div>
                      </div>
                    </div>
                  )}

                  {organization.contact_phone && (
                    <div className="app-info-row">
                      <IonIcon icon={ICON_TELEFON} className="app-info-row__icon" style={{ color: 'var(--app-color-users)' }} />
                      <div>
                        <div className="app-info-row__label">Telefon</div>
                        <div className="app-info-row__value">{organization.contact_phone}</div>
                      </div>
                    </div>
                  )}

                  {organization.address && (
                    <div className="app-info-row">
                      <IonIcon icon={ICON_ORT} className="app-info-row__icon" style={{ color: 'var(--app-color-users)' }} />
                      <div>
                        <div className="app-info-row__label">Adresse</div>
                        <div className="app-info-row__value">{organization.address}</div>
                      </div>
                    </div>
                  )}

                  {organization.website_url && (
                    <div className="app-info-row">
                      <IonIcon icon={ICON_WELT} className="app-info-row__icon" style={{ color: 'var(--app-color-users)' }} />
                      <div>
                        <div className="app-info-row__label">Website</div>
                        <div className="app-info-row__value">{organization.website_url}</div>
                      </div>
                    </div>
                  )}

                  {isSuperAdmin && (
                    <div className="app-info-row">
                      <IonIcon icon={ICON_UHRZEIT} className="app-info-row__icon" style={{ color: 'var(--app-color-users)' }} />
                      <div>
                        <div className="app-info-row__label">Laufzeit</div>
                        <div className="app-info-row__value">
                          {organization.trial_ends_at
                            ? (() => {
                                const end = new Date(organization.trial_ends_at);
                                const days = tageBis(end); // Kalendertage, siehe eventFormatting.ts
                                return days >= 0
                                  ? <span>{end.toLocaleDateString('de-DE')} ({days} Tag{days === 1 ? '' : 'e'} übrig){organization.is_trial ? ' · Testphase' : ''}</span>
                                  : <span style={{ color: 'var(--app-color-events)' }}>{end.toLocaleDateString('de-DE')} (abgelaufen)</span>;
                              })()
                            : <span>unbegrenzt</span>}
                        </div>
                      </div>
                    </div>
                  )}
                </IonCardContent>
              </IonCard>
            </IonList>

            {/* VERLAUF: Erstellt + Aktualisiert */}
            <IonList className="app-section-inset" inset={true}>
              <IonListHeader>
                <div className="app-section-icon app-section-icon--organizations">
                  <IonIcon icon={ICON_ORGANISATION} />
                </div>
                <IonLabel>Verlauf</IonLabel>
              </IonListHeader>
              <IonCard className="app-card">
                <IonCardContent className="app-card-content">
                  <div className="app-info-row">
                    <IonIcon icon={ICON_UHRZEIT} className="app-info-row__icon" style={{ color: 'var(--app-color-users)' }} />
                    <div>
                      <div className="app-info-row__label">Erstellt</div>
                      <div className="app-info-row__value">{new Date(organization.created_at).toLocaleDateString('de-DE')}</div>
                    </div>
                  </div>
                  <div className="app-info-row">
                    <IonIcon icon={ICON_TERMIN} className="app-info-row__icon" style={{ color: 'var(--app-color-users)' }} />
                    <div>
                      <div className="app-info-row__label">Aktualisiert</div>
                      <div className="app-info-row__value">{new Date(organization.updated_at).toLocaleDateString('de-DE')}</div>
                    </div>
                  </div>
                </IonCardContent>
              </IonCard>
            </IonList>
          </>
        )}

        {/* SEKTION: Organisations-Daten (nur Edit-Modus) */}
        {viewMode === 'edit' && (
        <IonList inset={true} className="app-modal-section">
          <IonListHeader>
            <div className="app-section-icon app-section-icon--organizations">
              <IonIcon icon={ICON_ORGANISATION} />
            </div>
            <IonLabel>Organisation</IonLabel>
          </IonListHeader>
          <IonCard className="app-card">
            <IonCardContent style={{ padding: 'var(--app-abstand-basis)' }}>
              <IonList style={{ background: 'transparent' }}>
                <IonItem lines="full" style={{ '--background': 'transparent' }}>
                  <IonLabel position="stacked">Name der Organisation *</IonLabel>
                  <IonInput
                    value={formData.display_name}
                    onIonInput={(e) => setFormData({ ...formData, display_name: e.detail.value! })}
                    placeholder="z.B. Kirchengemeinde Musterstadt"
                    disabled={isSubmitting}
                  />
                </IonItem>

                <IonItem lines="full" style={{ '--background': 'transparent' }}>
                  <IonLabel position="stacked">Beschreibung (optional)</IonLabel>
                  <IonTextarea
                    value={formData.description}
                    onIonInput={(e) => setFormData({ ...formData, description: e.detail.value! })}
                    placeholder="Kurze Beschreibung"
                    autoGrow={true}
                    rows={2}
                    disabled={isSubmitting}
                  />
                </IonItem>

                <IonItem lines="none" style={{ '--background': 'transparent' }}>
                  <IonLabel position="stacked">Kirchenkreis (optional)</IonLabel>
                  <IonInput
                    value={formData.kirchenkreis}
                    onIonInput={(e) => setFormData({ ...formData, kirchenkreis: e.detail.value! })}
                    placeholder="z.B. Kirchenkreis Musterland"
                    disabled={isSubmitting}
                  />
                </IonItem>
              </IonList>
            </IonCardContent>
          </IonCard>
        </IonList>
        )}

        {/* SEKTION: Kontakt (nur Edit-Modus) */}
        {viewMode === 'edit' && (
        <IonList inset={true} className="app-modal-section">
          <IonListHeader>
            <div className="app-section-icon app-section-icon--organizations">
              <IonIcon icon={ICON_MAIL} />
            </div>
            <IonLabel>Kontakt</IonLabel>
          </IonListHeader>
          <IonCard className="app-card">
            <IonCardContent style={{ padding: 'var(--app-abstand-basis)' }}>
              <IonList style={{ background: 'transparent' }}>
                <IonItem lines="full" style={{ '--background': 'transparent' }}>
                  <IonLabel position="stacked">Ansprechpartner:in</IonLabel>
                  <IonInput value={formData.contact_name} onIonInput={(e) => setFormData({ ...formData, contact_name: e.detail.value! })} placeholder="z.B. Pastorin Müller" disabled={isSubmitting} />
                </IonItem>
                <IonItem lines="full" style={{ '--background': 'transparent' }}>
                  <IonLabel position="stacked">E-Mail</IonLabel>
                  <IonInput type="email" value={formData.contact_email} onIonInput={(e) => setFormData({ ...formData, contact_email: e.detail.value! })} placeholder="kontakt@beispiel.de" disabled={isSubmitting} />
                </IonItem>
                <IonItem lines="full" style={{ '--background': 'transparent' }}>
                  <IonLabel position="stacked">Telefon</IonLabel>
                  <IonInput type="tel" value={formData.contact_phone} onIonInput={(e) => setFormData({ ...formData, contact_phone: e.detail.value! })} placeholder="04834 12345" disabled={isSubmitting} />
                </IonItem>
                <IonItem lines="full" style={{ '--background': 'transparent' }}>
                  <IonLabel position="stacked">Adresse</IonLabel>
                  <IonTextarea
                    value={formData.address}
                    onIonInput={(e) => setFormData({ ...formData, address: e.detail.value! })}
                    placeholder="Kirchstraße 1, 12345 Musterstadt"
                    autoGrow={true}
                    rows={2}
                    disabled={isSubmitting}
                  />
                </IonItem>
                <IonItem lines="none" style={{ '--background': 'transparent' }}>
                  <IonLabel position="stacked">Website</IonLabel>
                  <IonInput type="url" value={formData.website_url} onIonInput={(e) => setFormData({ ...formData, website_url: e.detail.value! })} placeholder="https://www.beispiel.de" disabled={isSubmitting} />
                </IonItem>
              </IonList>
            </IonCardContent>
          </IonCard>
        </IonList>
        )}

        {/* SEKTION: Status (Aktiv/Inaktiv-Toggle, nur Edit-Modus) */}
        {viewMode === 'edit' && (
        <IonList inset={true} className="app-modal-section">
          <IonListHeader>
            <div className="app-section-icon app-section-icon--organizations">
              <IonIcon icon={ICON_SCHILD} />
            </div>
            <IonLabel>Status</IonLabel>
          </IonListHeader>
          <IonCard className="app-card">
            <IonCardContent style={{ padding: 'var(--app-abstand-basis)' }}>
              <IonList style={{ background: 'transparent' }}>
                <IonItem lines="none" style={{ '--background': 'transparent' }}>
                  <IonLabel>
                    <h3 style={{ fontWeight: 'var(--app-schrift-mittel)', margin: '0 0 var(--app-abstand-mini) 0' }}>Organisation aktiv</h3>
                    <p style={{ color: 'var(--app-text-secondary)', margin: 0, fontSize: 'var(--app-text-sekundaer)' }}>Benutzer können sich anmelden</p>
                  </IonLabel>
                  <IonToggle slot="end" className="app-toggle--users" checked={formData.is_active} onIonChange={(e) => {
                    const checked = e.detail.checked;
                    // Beim Deaktivieren einer bestehenden Org warnen: alle Nutzer werden ausgesperrt.
                    if (!checked && isEditMode) {
                      presentAlert({
                        header: 'Organisation deaktivieren?',
                        message: 'Alle Konfis, das Team und die Admins dieser Organisation können sich dann nicht mehr anmelden und werden aus laufenden Sitzungen abgemeldet. Fortfahren?',
                        buttons: [
                          {
                            text: 'Abbrechen',
                            role: 'cancel',
                            handler: () => {
                              // Toggle visuell zuruecksetzen
                              setFormData({ ...formData, is_active: true });
                            }
                          },
                          {
                            text: 'Deaktivieren',
                            role: 'destructive',
                            handler: () => setFormData({ ...formData, is_active: false })
                          }
                        ]
                      });
                    } else {
                      setFormData({ ...formData, is_active: checked });
                    }
                  }} disabled={isSubmitting} />
                </IonItem>
                {!formData.is_active && (
                  <IonItem lines="none" style={{ '--background': 'rgba(var(--app-color-danger-rgb), 0.08)', borderRadius: 'var(--app-radius-knopf)', marginTop: 'var(--app-abstand-eng)' }}>
                    <IonIcon icon={ICON_WARNHINWEIS} slot="start" style={{ color: 'var(--app-color-danger)' }} />
                    <IonLabel><p style={{ color: 'var(--app-color-danger)', margin: 0, fontWeight: 'var(--app-schrift-mittel)' }}>Inaktive Organisationen sind gesperrt</p></IonLabel>
                  </IonItem>
                )}
              </IonList>
            </IonCardContent>
          </IonCard>
        </IonList>
        )}

        {/* SEKTION: Administrator erstellen (nur bei neuer Organisation) */}
        {!isEditMode && (
          <IonList inset={true} className="app-modal-section">
            <IonListHeader>
              <div className="app-section-icon app-section-icon--organizations">
                <IonIcon icon={ICON_PERSON} />
              </div>
              <IonLabel>Organisations-Administrator</IonLabel>
            </IonListHeader>
            <IonCard className="app-card">
              <IonCardContent style={{ padding: 'var(--app-abstand-basis)' }}>
                <IonList style={{ background: 'transparent' }}>
                  <IonItem lines="full" style={{ '--background': 'transparent' }}>
                    <IonLabel position="stacked">Name des Administrators *</IonLabel>
                    <IonInput value={formData.admin_name} onIonInput={(e) => setFormData({ ...formData, admin_name: e.detail.value! })} placeholder="z.B. Pastor Müller" disabled={isSubmitting} />
                  </IonItem>
                  <IonItem lines="full" style={{ '--background': 'transparent' }}>
                    <IonLabel position="stacked">Login-Benutzername *</IonLabel>
                    <IonInput value={formData.admin_username} onIonInput={(e) => setFormData({ ...formData, admin_username: e.detail.value! })} placeholder="z.B. pmueller" disabled={isSubmitting} />
                  </IonItem>
                  <IonItem lines="none" style={{ '--background': 'transparent' }}>
                    <IonLabel position="stacked">Passwort *</IonLabel>
                    <IonInput type={showAdminPassword ? 'text' : 'password'} value={formData.admin_password} onIonInput={(e) => setFormData({ ...formData, admin_password: e.detail.value! })} placeholder="Mind. 8 Zeichen, Groß/Klein, Zahl, Sonderzeichen" disabled={isSubmitting} />
                    <IonButton aria-label="Passwort anzeigen oder verbergen" slot="end" fill="clear" onClick={() => setShowAdminPassword(v => !v)}>
                      <IonIcon icon={showAdminPassword ? ICON_VERBORGEN : ICON_SICHTBAR} />
                    </IonButton>
                  </IonItem>
                </IonList>

                {/* Gleicher Knopf wie beim Zuruecksetzen eines Passworts */}
                <IonButton expand="block" fill="outline" onClick={handleAdminPasswordVorschlag} disabled={isSubmitting} style={{ marginTop: 'var(--app-abstand-mittel)' }}>
                  <IonIcon icon={ICON_FUNKELN} slot="start" />
                  Sicheres Passwort vorschlagen
                </IonButton>

                <IonItem lines="none" style={{ '--background': 'rgba(var(--app-color-users-rgb), 0.08)', borderRadius: 'var(--app-radius-knopf)', marginTop: 'var(--app-abstand-mittel)' }}>
                  <IonIcon icon={ICON_SCHILD} slot="start" style={{ color: 'var(--app-color-users)' }} />
                  <IonLabel>
                    <p style={{ color: 'var(--app-color-users)', margin: 0, fontWeight: 'var(--app-schrift-mittel)', fontSize: 'var(--app-text-sekundaer)' }}>
                      Der Administrator kann die gesamte Organisation verwalten
                    </p>
                  </IonLabel>
                </IonItem>
              </IonCardContent>
            </IonCard>
          </IonList>
        )}

        {/* SEKTION: Organisations-Administratoren verwalten (nur im Edit-Modus) */}
        {isEditMode && viewMode === 'edit' && (
          <IonList inset={true} className="app-modal-section">
            <IonListHeader>
              <div className="app-section-icon app-section-icon--organizations">
                <IonIcon icon={ICON_PERSON} />
              </div>
              <IonLabel>Organisations-Administratoren</IonLabel>
            </IonListHeader>
            <IonCard className="app-card">
              <IonCardContent style={{ padding: 'var(--app-abstand-basis)' }}>
                {/* Bestehende Admins */}
                {orgAdmins.length > 0 ? (
                  <div style={{ display: 'flex', flexDirection: 'column' }}>
                    {orgAdmins.map((admin) => (
                      <div key={admin.id} style={{ marginBottom: 'var(--app-abstand-eng)' }}>
                        <IonItem
                          button
                          detail={false}
                          lines="none"
                          onClick={() => openPasswordModal(admin)}
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
                            className="app-list-item app-list-item--teamer"
                            style={{ width: '100%', position: 'relative', overflow: 'hidden' }}
                          >
                            <div className="app-list-item__row">
                              <div className="app-list-item__main">
                                <div
                                  className="app-icon-circle app-icon-circle--lg app-icon-circle--teamer"
                                  style={{ color: 'white', fontWeight: 'var(--app-schrift-halbfett)' }}
                                >
                                  {getInitials(admin.display_name)}
                                </div>
                                <div className="app-list-item__content">
                                  <div className="app-list-item__title">{admin.display_name}</div>
                                  <div className="app-list-item__meta">
                                    <span className="app-list-item__meta-item">
                                      <IonIcon icon={ICON_PERSON} style={{ color: 'var(--app-color-teamer)' }} />
                                      {admin.username}
                                    </span>
                                    {admin.email && (
                                      <span className="app-list-item__meta-item">
                                        <IonIcon icon={ICON_MAIL} style={{ color: 'var(--app-color-teamer)' }} />
                                        {admin.email}
                                      </span>
                                    )}
                                  </div>
                                </div>
                              </div>
                            </div>
                          </div>
                        </IonItem>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div style={{ textAlign: 'center', padding: 'var(--app-abstand-basis)', color: 'var(--app-text-secondary)' }}>
                    <IonIcon icon={ICON_WARNHINWEIS} style={{ fontSize: 'var(--app-anzeige-zahl)', color: 'var(--app-color-badges)', marginBottom: 'var(--app-abstand-eng)', display: 'block' }} />
                    Kein Administrator vorhanden
                  </div>
                )}

                {/* Neuen Admin hinzufügen */}
                {showAddAdmin && (
                  <div style={{ marginTop: 'var(--app-abstand-basis)', padding: 'var(--app-abstand-basis)', background: 'rgba(var(--app-color-users-rgb), 0.05)', borderRadius: 'var(--app-radius-karte)', border: '1px dashed var(--app-color-users)' }}>
                    <h4 style={{ margin: '0 0 var(--app-abstand-mittel) 0', fontSize: 'var(--app-text-betont)', fontWeight: 'var(--app-schrift-halbfett)', color: 'var(--app-text-primary)' }}>Neuen Administrator hinzufügen</h4>
                    <div style={{ display: 'flex', flexDirection: 'column' }}>
                      <IonItem style={{ '--background': 'white', '--border-radius': '10px', marginBottom: 'var(--app-abstand-eng)' }}>
                        <IonLabel position="stacked">Name *</IonLabel>
                        <IonInput
                          value={newAdminData.display_name}
                          onIonInput={(e) => setNewAdminData({ ...newAdminData, display_name: e.detail.value! })}
                          placeholder="z.B. Pastor Müller"
                          disabled={addingAdmin}
                        />
                      </IonItem>
                      <IonItem style={{ '--background': 'white', '--border-radius': '10px', marginBottom: 'var(--app-abstand-eng)' }}>
                        <IonLabel position="stacked">Login-Benutzername *</IonLabel>
                        <IonInput
                          value={newAdminData.username}
                          onIonInput={(e) => setNewAdminData({ ...newAdminData, username: e.detail.value! })}
                          placeholder="z.B. pmueller"
                          disabled={addingAdmin}
                        />
                      </IonItem>
                      <IonItem style={{ '--background': 'white', '--border-radius': '10px', marginBottom: 'var(--app-abstand-eng)' }}>
                        <IonLabel position="stacked">Passwort *</IonLabel>
                        <IonInput
                          type="password"
                          value={newAdminData.password}
                          onIonInput={(e) => setNewAdminData({ ...newAdminData, password: e.detail.value! })}
                          placeholder="Mindestens 6 Zeichen"
                          disabled={addingAdmin}
                        />
                      </IonItem>
                    </div>
                    <div style={{ display: 'flex', gap: 'var(--app-abstand-eng)', marginTop: 'var(--app-abstand-mittel)' }}>
                      <IonButton
                        expand="block"
                        fill="outline"
                        onClick={() => {
                          setShowAddAdmin(false);
                          setNewAdminData({ display_name: '', username: '', password: '' });
                        }}
                        disabled={addingAdmin}
                        style={{ flex: 1, '--border-color': 'var(--app-text-secondary)', '--color': 'var(--app-text-secondary)' }}
                      >
                        Abbrechen
                      </IonButton>
                      <IonButton
                        expand="block"
                        onClick={handleAddAdmin}
                        disabled={!newAdminData.display_name.trim() || !newAdminData.username.trim() || !newAdminData.password.trim() || addingAdmin || !isOnline}
                        style={{ flex: 1, '--background': 'var(--app-color-users)', '--background-activated': 'var(--app-color-users-dunkel)' }}
                      >
                        {!isOnline ? <><IonIcon icon={ICON_OFFLINE} /> Du bist offline</> : addingAdmin ? <IonSpinner name="crescent" /> : 'Hinzufügen'}
                      </IonButton>
                    </div>
                  </div>
                )}

                {/* Hinzufügen-Button — gleiches Muster wie EventModal (expand block, outline) */}
                {!showAddAdmin && (
                  <div style={{ marginTop: 'var(--app-abstand-basis)' }}>
                    <IonButton
                      expand="block"
                      fill="outline"
                      onClick={() => setShowAddAdmin(true)}
                    >
                      <IonIcon icon={ICON_HINZUFUEGEN_GEFUELLT} slot="start" />
                      Administrator hinzufügen
                    </IonButton>
                  </div>
                )}
              </IonCardContent>
            </IonCard>
          </IonList>
        )}

        {/* SEKTION: Mitglieder & Zuweisungen (nur super_admin, nur Edit bestehender Org) */}
        {isSuperAdmin && isEditMode && viewMode === 'edit' && (
          <IonList inset={true} className="app-modal-section">
            <IonListHeader>
              <div className="app-section-icon app-section-icon--users">
                <IonIcon icon={ICON_GRUPPE} />
              </div>
              <IonLabel>Mitglieder & Zuweisungen</IonLabel>
            </IonListHeader>
            <IonCard className="app-card">
              <IonCardContent style={{ padding: 'var(--app-abstand-basis)' }}>
                <p style={{ margin: '0 0 var(--app-abstand-mittel) 0', fontSize: 'var(--app-text-sekundaer)', color: 'var(--app-text-secondary)' }}>
                  Bestehende Admins oder Team-Mitglieder anderer Organisationen dieser
                  Organisation zuweisen — sie können dann per Org-Wechsler hierher
                  springen. Konfis sind ausgenommen.
                </p>

                {/* Hinzufügen: Suche + Rolle */}
                <IonList style={{ background: 'transparent' }}>
                  <IonItem lines="full" style={{ '--background': 'transparent' }}>
                    <IonIcon icon={ICON_SUCHE} slot="start" style={{ color: 'var(--app-text-system)', fontSize: 'var(--app-text-standard)' }} />
                    <IonInput
                      value={memberSearch}
                      onIonInput={(e) => setMemberSearch(e.detail.value || '')}
                      placeholder="Name oder Benutzername suchen..."
                      clearInput
                    />
                  </IonItem>
                  <IonItem lines="none" style={{ '--background': 'transparent' }}>
                    <IonIcon icon={ICON_PERSON_HINZUFUEGEN} slot="start" style={{ color: 'var(--app-text-system)', fontSize: 'var(--app-text-standard)' }} />
                    <IonLabel>Rolle</IonLabel>
                    <IonSelect
                      value={memberRole}
                      onIonChange={(e) => setMemberRole(e.detail.value)}
                      interface="popover"
                      slot="end"
                    >
                      {MEMBER_ROLE_OPTIONS.map(r => (
                        <IonSelectOption key={r.value} value={r.value}>{r.label}</IonSelectOption>
                      ))}
                    </IonSelect>
                  </IonItem>
                </IonList>

                {/* Suchergebnisse */}
                {memberSearching && (
                  <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--app-abstand-eng)', padding: 'var(--app-abstand-eng) var(--app-abstand-mini)', color: 'var(--app-text-secondary)' }}>
                    <IonSpinner name="dots" /> Suche…
                  </div>
                )}
                {!memberSearching && memberSearch.trim().length >= 2 && memberSearchResults.filter(u => !memberIds.has(u.id)).length === 0 && (
                  <div style={{ padding: 'var(--app-abstand-eng) var(--app-abstand-mini)', color: 'var(--app-text-secondary)', fontSize: 'var(--app-text-basis)' }}>Keine passenden Benutzer:innen</div>
                )}
                {memberSearchResults.filter(u => !memberIds.has(u.id)).length > 0 && (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--app-abstand-eng)', marginTop: 'var(--app-abstand-eng)' }}>
                    {memberSearchResults.filter(u => !memberIds.has(u.id)).map(u => (
                      <IonItem
                        key={u.id}
                        button
                        detail={false}
                        lines="none"
                        onClick={() => memberAddingId === null && handleAddMember(u.id)}
                        style={{ '--background': 'rgba(var(--app-color-users-rgb), 0.05)', '--border-radius': '10px' }}
                      >
                        <IonLabel>
                          <h3 style={{ margin: 0 }}>{u.display_name}</h3>
                          <p style={{ margin: 0 }}>@{u.username}{u.primary_organization_name ? ` · ${u.primary_organization_name}` : ''}</p>
                        </IonLabel>
                        {memberAddingId === u.id
                          ? <IonSpinner name="dots" slot="end" />
                          : <IonIcon icon={ICON_PLUS_KREIS} slot="end" className="app-icon-color--users" style={{ fontSize: 'var(--app-text-ueberschrift)' }} />}
                      </IonItem>
                    ))}
                  </div>
                )}

                {/* Aktuelle Mitglieder */}
                <div style={{ marginTop: 'var(--app-abstand-basis)', marginBottom: 'var(--app-abstand-eng)', fontSize: 'var(--app-text-basis)', fontWeight: 'var(--app-schrift-halbfett)', color: 'var(--app-text-primary)' }}>
                  Aktuelle Mitglieder
                </div>
                {membersLoading ? (
                  <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--app-abstand-eng)', padding: 'var(--app-abstand-eng) var(--app-abstand-mini)', color: 'var(--app-text-secondary)' }}>
                    <IonSpinner name="dots" /> Wird geladen…
                  </div>
                ) : members.length === 0 ? (
                  <div style={{ padding: 'var(--app-abstand-eng) var(--app-abstand-mini)', color: 'var(--app-text-secondary)', fontSize: 'var(--app-text-basis)' }}>Noch keine Mitglieder</div>
                ) : (
                  members.map(m => (
                    <IonItemSliding key={m.id} style={{ marginBottom: 'var(--app-abstand-eng)' }}>
                      <IonItem lines="none" style={{ '--background': 'transparent', '--padding-start': '0', '--inner-padding-end': '0' }}>
                        <IonLabel>
                          <h3 style={{ margin: 0 }}>{m.display_name}</h3>
                          <p style={{ margin: 0 }}>@{m.username} · {m.role_display_name || m.role_name}</p>
                        </IonLabel>
                        {m.is_primary && <IonNote slot="end">Primär</IonNote>}
                      </IonItem>
                      {/* Primaer-Org kann hier nicht entfernt werden (Server blockt ebenfalls) */}
                      {!m.is_primary && (
                        <IonItemOptions side="end" className="app-swipe-actions">
                          <IonItemOption onClick={() => { closeOpenSlidingItems(); handleRemoveMember(m); }} className="app-swipe-action" aria-label="Mitglied entfernen">
                            <div className="app-icon-circle app-icon-circle--lg app-icon-circle--danger">
                              <IonIcon icon={ICON_LOESCHEN_GEFUELLT} />
                            </div>
                          </IonItemOption>
                        </IonItemOptions>
                      )}
                    </IonItemSliding>
                  ))
                )}
              </IonCardContent>
            </IonCard>
          </IonList>
        )}

        {/* SEKTION: Konfi-Limit (nur super_admin, im Erstellen- und Bearbeiten-Modus) */}
        {isSuperAdmin && viewMode === 'edit' && (
          <IonList inset={true} className="app-modal-section">
            <IonListHeader>
              <div className="app-section-icon app-section-icon--organizations">
                <IonIcon icon={ICON_GRUPPE_GEFUELLT} />
              </div>
              <IonLabel>Konfi-Limit (Tarif)</IonLabel>
            </IonListHeader>
            <IonCard className="app-card">
              <IonCardContent style={{ padding: 'var(--app-abstand-basis)' }}>
                <IonList style={{ background: 'transparent' }}>
                  {/* Tarif-Auswahl als Popover (Website-Stufen + Eigenes Limit) */}
                  <IonItem lines="full" style={{ '--background': 'transparent' }}>
                    <IonLabel position="stacked">Tarif</IonLabel>
                    <IonSelect
                      value={isCustomLimit ? '__custom__' : maxKonfis.trim()}
                      interface="popover"
                      interfaceOptions={{ cssClass: 'app-select-popover--wide' }}
                      placeholder="Tarif wählen"
                      onIonChange={(e) => {
                        const val = e.detail.value;
                        if (val === '__custom__') {
                          // Auf Eigenes Limit umschalten: Feld leeren falls es vorher ein Tarif war
                          setIsCustomLimit(true);
                        } else {
                          setIsCustomLimit(false);
                          handleMaxKonfisChange(val);
                        }
                      }}
                    >
                      {KONFI_TARIFE.map((tarif) => (
                        <IonSelectOption key={tarif.label} value={tarif.value}>
                          {tarif.label}{tarif.value ? ` — bis ${tarif.value} Konfis` : ' — unbegrenzt'}
                        </IonSelectOption>
                      ))}
                      <IonSelectOption value="__custom__">Eigenes Limit…</IonSelectOption>
                    </IonSelect>
                  </IonItem>

                  {/* Eigenes Limit-Feld nur wenn "Eigenes Limit" gewaehlt ist */}
                  {isCustomLimit && (
                    <IonItem lines="none" style={{ '--background': 'transparent' }}>
                      <IonLabel position="stacked">Eigenes Limit (leer = unbegrenzt)</IonLabel>
                      <IonInput
                        type="number"
                        inputmode="numeric"
                        min="0"
                        value={maxKonfis}
                        onIonInput={(e) => handleMaxKonfisChange(e.detail.value ?? '')}
                        placeholder={isOnline ? "z.B. 30 — leer lassen für unbegrenzt" : "Ohne Internetverbindung nicht möglich"}
                        title={isOnline ? undefined : "Ohne Internetverbindung nicht möglich"}
                        disabled={!isOnline}
                      />
                    </IonItem>
                  )}
                </IonList>

                <IonItem lines="none" style={{ '--background': 'rgba(var(--app-color-users-rgb), 0.08)', borderRadius: 'var(--app-radius-knopf)', marginTop: 'var(--app-abstand-eng)' }}>
                  <IonIcon icon={ICON_WARNHINWEIS} slot="start" style={{ color: 'var(--app-color-users)' }} />
                  <IonLabel>
                    <p style={{ color: 'var(--app-color-users)', margin: 0, fontSize: 'var(--app-text-sekundaer)' }}>
                      Bis zu 5 Konfis über dem Limit sind nach Bestätigung möglich. Danach ist ein Tarif-Upgrade nötig. Wird beim Speichern oben übernommen.
                    </p>
                  </IonLabel>
                </IonItem>
              </IonCardContent>
            </IonCard>
          </IonList>
        )}

        {/* SEKTION: Zeitraum (nur super_admin, im Erstellen- und Bearbeiten-Modus) */}
        {isSuperAdmin && viewMode === 'edit' && (
          <IonList inset={true} className="app-modal-section">
            <IonListHeader>
              <div className="app-section-icon app-section-icon--organizations">
                <IonIcon icon={ICON_UHRZEIT} />
              </div>
              <IonLabel>Laufzeit</IonLabel>
            </IonListHeader>
            <IonCard className="app-card">
              <IonCardContent style={{ padding: 'var(--app-abstand-basis)' }}>
                {/* aktueller Status */}
                <div style={{ marginBottom: 'var(--app-abstand-mittel)', fontSize: 'var(--app-text-basis)', color: 'var(--app-text-body)', display: 'flex', alignItems: 'center', gap: 'var(--app-abstand-eng)' }}>
                  <IonIcon icon={ICON_UHRZEIT} style={{ color: 'var(--app-color-users)' }} />
                  {trialEndsAt
                    ? (() => {
                        const end = new Date(trialEndsAt);
                        const days = tageBis(end); // Kalendertage, siehe eventFormatting.ts
                        return days >= 0
                          ? <span><strong>{end.toLocaleDateString('de-DE')}</strong> ({days} Tag{days === 1 ? '' : 'e'} übrig){isTrial ? ' · Testphase' : ''}</span>
                          : <span style={{ color: 'var(--app-color-events)' }}><strong>{end.toLocaleDateString('de-DE')}</strong> (abgelaufen)</span>;
                      })()
                    : <span><strong>unbegrenzt</strong></span>}
                </div>

                <IonList style={{ background: 'transparent' }}>
                  {/* Zeitraum-Auswahl als Popover */}
                  <IonItem lines={isCustomTrialDate ? 'full' : 'full'} style={{ '--background': 'transparent' }}>
                    <IonLabel position="stacked">Zeitraum</IonLabel>
                    <IonSelect
                      value={isCustomTrialDate ? -1 : (trialEndsAt ? -2 : 0)}
                      interface="popover"
                      interfaceOptions={{ cssClass: 'app-select-popover--wide' }}
                      placeholder="Zeitraum wählen"
                      onIonChange={(e) => {
                        const days = e.detail.value as number;
                        if (days === -1) {
                          // Eigenes Datum: Datepicker einblenden, Default heute+30 falls leer
                          setIsCustomTrialDate(true);
                          if (!trialEndsAt) handleTrialChange(new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString());
                        } else if (days === -2) {
                          // no-op (Platzhalter für bereits gesetztes eigenes Datum)
                        } else if (days === 0) {
                          setIsCustomTrialDate(false);
                          handleTrialChange('');
                        } else {
                          setIsCustomTrialDate(false);
                          handleTrialChange(new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString());
                        }
                      }}
                    >
                      {ZEITRAUM_OPTIONEN.map((opt) => (
                        <IonSelectOption key={opt.label} value={opt.days}>{opt.label}</IonSelectOption>
                      ))}
                      {/* unsichtbarer Wert fuer "Datum gesetzt, aber keine Schnellauswahl aktiv" */}
                      {trialEndsAt && !isCustomTrialDate && <IonSelectOption value={-2}>Festes Datum</IonSelectOption>}
                    </IonSelect>
                  </IonItem>

                  {/* Eigenes Datum: Datepicker */}
                  {isCustomTrialDate && (
                    <IonItem lines="full" style={{ '--background': 'transparent' }}>
                      <IonLabel position="stacked">Enddatum</IonLabel>
                      <IonDatetimeButton datetime="trial-date-picker" />
                      <IonModal keepContentsMounted={true}>
                        <IonDatetime
                          id="trial-date-picker"
                          presentation="date"
                          firstDayOfWeek={1}
                          value={trialEndsAt || undefined}
                          onIonChange={(e) => {
                            const v = e.detail.value as string;
                            if (v) handleTrialChange(new Date(v).toISOString());
                          }}
                        />
                      </IonModal>
                    </IonItem>
                  )}

                  {/* Trial-Haekchen: nur sinnvoll wenn ein Datum gesetzt ist */}
                  {trialEndsAt && (
                    <IonItem lines="none" style={{ '--background': 'transparent' }}>
                      <IonLabel>
                        <h3 style={{ fontWeight: 'var(--app-schrift-mittel)', margin: '0 0 var(--app-abstand-mini) 0' }}>Als Testphase kennzeichnen</h3>
                        <p style={{ color: 'var(--app-text-secondary)', margin: 0, fontSize: 'var(--app-text-sekundaer)' }}>Zeigt im Dashboard einen Hinweis mit Restlaufzeit</p>
                      </IonLabel>
                      <IonToggle slot="end" className="app-toggle--users" checked={isTrial} onIonChange={(e) => handleIsTrialChange(e.detail.checked)} />
                    </IonItem>
                  )}
                </IonList>

                <IonItem lines="none" style={{ '--background': 'rgba(var(--app-color-users-rgb), 0.08)', borderRadius: 'var(--app-radius-knopf)', marginTop: 'var(--app-abstand-mittel)' }}>
                  <IonIcon icon={ICON_WARNHINWEIS} slot="start" style={{ color: 'var(--app-color-users)' }} />
                  <IonLabel>
                    <p style={{ color: 'var(--app-color-users)', margin: 0, fontSize: 'var(--app-text-sekundaer)' }}>
                      Nach Ablauf des Zeitraums wird die Organisation automatisch gesperrt — niemand kann sich mehr anmelden. Ohne Datum bleibt der Zugang unbegrenzt. Wird beim Speichern oben übernommen.
                    </p>
                  </IonLabel>
                </IonItem>
              </IonCardContent>
            </IonCard>
          </IonList>
        )}

      </IonContent>
    </IonPage>
  );
};

export default OrganizationManagementModal;
