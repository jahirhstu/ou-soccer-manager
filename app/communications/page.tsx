import { AppShell } from '../(shell)';
import { communicationsData } from '@/lib/actions/communications';
import { Communications } from '@/components/Communications';

export default async function CommunicationsPage() {
  try {
    const data = await communicationsData();
    return <AppShell><Communications initial={data} /></AppShell>;
  } catch (error) {
    return <AppShell><h1 className="page-title">Communications</h1><p className="panel p-5">{error instanceof Error ? error.message : 'Unable to load communications'}</p></AppShell>;
  }
}
