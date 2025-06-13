import { useEffect } from 'react';
import { useRouter } from 'expo-router';

export default function IndexRedirect() {
  const router = useRouter();

  useEffect(() => {
    if (router.canGoBack || typeof document !== 'undefined') {
      // running on web — proceed
      router.replace('/auth');
    } else {
      // wait for layout mount in native apps
      setTimeout(() => {
        router.replace('/auth');
      }, 0);
    }
  }, []);

  return null;
}
