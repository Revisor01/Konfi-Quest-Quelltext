import React from 'react';
import { useApp } from '../../../contexts/AppContext';
import ChallengesPage from '../../shared/ChallengesPage';

// Der Zwischenspeicher hängt bewusst zusätzlich an der Person: Das Backend
// filtert die Teamer-Sicht nach zugewiesenen Jahrgängen, zwei Teamer:innen
// derselben Organisation sehen also NICHT dasselbe.
//
// Teamer:innen nutzen dieselbe View und dieselben Modals wie die Leitung —
// was sie sehen und dürfen, entscheidet das Backend.
const TeamerChallengesPage: React.FC = () => {
  const { user } = useApp();

  return (
    <ChallengesPage
      cacheKey={`teamer:challenges:${user?.organization_id}:${user?.id}`}
      modalPageId="teamer-challenges"
    />
  );
};

export default TeamerChallengesPage;
