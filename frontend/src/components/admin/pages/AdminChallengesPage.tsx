import React from 'react';
import { useApp } from '../../../contexts/AppContext';
import ChallengesPage from '../../shared/ChallengesPage';

const AdminChallengesPage: React.FC = () => {
  const { user } = useApp();

  return (
    <ChallengesPage
      cacheKey={'admin:challenges:' + user?.organization_id}
      modalPageId="admin-challenges"
    />
  );
};

export default AdminChallengesPage;
