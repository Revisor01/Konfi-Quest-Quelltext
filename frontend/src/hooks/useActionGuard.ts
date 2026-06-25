import { useState, useCallback, useRef } from 'react';

interface ActionGuardResult {
  isSubmitting: boolean;
  guard: <T>(action: () => Promise<T>) => Promise<T>;
}

export function useActionGuard(): ActionGuardResult {
  const [isSubmitting, setIsSubmitting] = useState(false);
  const guardRef = useRef(false);

  const guard = useCallback(async <T>(action: () => Promise<T>): Promise<T> => {
    if (guardRef.current) {
      throw new Error('Aktion läuft bereits');
    }
    guardRef.current = true;
    setIsSubmitting(true);
    try {
      const result = await action();
      return result;
    } finally {
      guardRef.current = false;
      setIsSubmitting(false);
    }
  }, []);

  return { isSubmitting, guard };
}
