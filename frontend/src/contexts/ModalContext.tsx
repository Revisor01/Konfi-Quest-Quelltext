import React, { createContext, useContext, useState, useRef, useEffect, useLayoutEffect, useCallback } from 'react';
import { useLocation } from 'react-router-dom';
import { modalController } from '@ionic/core';

interface ModalContextType {
  presentingElement: HTMLElement | undefined;
  registerPage: (tabId: string, element: HTMLElement | null) => void;
  getCurrentPresentingElement: () => HTMLElement | undefined;
  cleanupModals: () => Promise<void>;
}

const ModalContext = createContext<ModalContextType | undefined>(undefined);

export const ModalProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [tabPresentingElements, setTabPresentingElements] = useState<Map<string, HTMLElement>>(new Map());
  const location = useLocation();

  // Modal cleanup function
  const cleanupModals = async () => {
    try {
      // Dismiss all active modals
      await modalController.dismiss();
    } catch (error) {
      // Cleanup warning ignored - expected when no modals active
    }
  };

  // Listen for route changes to cleanup modals
  useEffect(() => {
    cleanupModals();
  }, [location.pathname]);

  const registerPage = useCallback((tabId: string, element: HTMLElement | null) => {
    if (element) {
      setTabPresentingElements(prev => {
        const newMap = new Map(prev);
        newMap.set(tabId, element);
        return newMap;
      });
    }
  }, []);

  const getCurrentPresentingElement = () => {
    // Aktuelle Route ermitteln
    const currentPath = location.pathname;
    let currentTabId = '';

    // Admin Routes - Tab IDs müssen mit MainTabs.tsx übereinstimmen
    if (currentPath.includes('/admin/konfis')) currentTabId = 'admin-konfis';
    else if (currentPath.includes('/admin/chat')) currentTabId = 'admin-chat';
    else if (currentPath.includes('/admin/activities')) currentTabId = 'admin-activities';
    else if (currentPath.includes('/admin/events')) currentTabId = 'admin-events';
    else if (currentPath.includes('/admin/badges')) currentTabId = 'admin-badges';
    else if (currentPath.includes('/admin/requests')) currentTabId = 'admin-requests';
    else if (currentPath.includes('/admin/users')) currentTabId = 'admin-users';
    else if (currentPath.includes('/admin/organizations')) currentTabId = 'admin-organizations';
    else if (currentPath.includes('/admin/profile')) currentTabId = 'admin-profile';
    else if (currentPath.includes('/admin/settings/categories')) currentTabId = 'admin-categories';
    else if (currentPath.includes('/admin/settings/jahrgaenge')) currentTabId = 'admin-jahrgaenge';
    else if (currentPath.includes('/admin/settings/levels')) currentTabId = 'admin-levels';
    else if (currentPath.includes('/admin/settings/certificates')) currentTabId = 'admin-certificates';
    else if (currentPath.includes('/admin/settings/dashboard')) currentTabId = 'admin-dashboard-settings';
    else if (currentPath.includes('/admin/settings')) currentTabId = 'admin-settings';
    else if (currentPath.includes('/admin/material')) currentTabId = 'admin-material';
    // Konfi Routes
    else if (currentPath.includes('/konfi/dashboard')) currentTabId = 'dashboard';
    else if (currentPath.includes('/konfi/events')) currentTabId = 'events';
    else if (currentPath.includes('/konfi/requests')) currentTabId = 'requests';
    else if (currentPath.includes('/konfi/badges')) currentTabId = 'badges';
    else if (currentPath.includes('/konfi/chat')) currentTabId = 'chat';
    else if (currentPath.includes('/konfi/profile')) currentTabId = 'profile';
    // Teamer Routes
    else if (currentPath.includes('/teamer/material')) currentTabId = 'teamer-material';
    else if (currentPath.includes('/teamer/events')) currentTabId = 'teamer-events';
    else if (currentPath.includes('/teamer/dashboard')) currentTabId = 'teamer-dashboard';
    else if (currentPath.includes('/teamer/chat')) currentTabId = 'teamer-chat';
    else if (currentPath.includes('/teamer/badges')) currentTabId = 'teamer-badges';
    else if (currentPath.includes('/teamer/profile')) currentTabId = 'teamer-profile';

    return tabPresentingElements.get(currentTabId);
  };

  const presentingElement = getCurrentPresentingElement();

  return (
    <ModalContext.Provider value={{ presentingElement, registerPage, getCurrentPresentingElement, cleanupModals }}>
      {children}
    </ModalContext.Provider>
  );
};

export const useModal = () => {
  const context = useContext(ModalContext);
  if (context === undefined) {
    throw new Error('useModal must be used within a ModalProvider');
  }
  return context;
};

export const useModalPage = (tabId: string) => {
  const { registerPage, presentingElement, cleanupModals } = useModal();
  const pageRef = useRef<HTMLElement>(null);

  useLayoutEffect(() => {
    if (pageRef.current) {
      registerPage(tabId, pageRef.current);
    } else {
      // Fallback mit laengerem Timeout
      const timeout = setTimeout(() => {
        if (pageRef.current) {
          registerPage(tabId, pageRef.current);
        }
      }, 500);

      return () => clearTimeout(timeout);
    }
  }, [registerPage, tabId]);

  return { pageRef, presentingElement, cleanupModals };
};
