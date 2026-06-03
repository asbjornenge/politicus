import { useEffect, useState } from 'react';
import { Loader2 } from 'lucide-react';
import type { IssueDetail } from '../api';
import { getDefaultIssueId, getIssue } from '../api';
import { IssueRenderer } from './IssuePage';

export function CurrentPage() {
  const [issue, setIssue] = useState<IssueDetail | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      setLoading(true);
      try {
        const id = await getDefaultIssueId();
        if (id) setIssue(await getIssue(id));
      } finally { setLoading(false); }
    })();
  }, []);

  if (loading && !issue) return (
    <p className="muted" style={{ textAlign: 'center', padding: 40 }}>
      <Loader2 size={20} className="spinner" style={{ verticalAlign: 'middle', marginRight: 8 }} />
      Composing today's edition…
    </p>
  );
  if (!issue) return (
    <p className="muted" style={{ textAlign: 'center', padding: 40 }}>
      Not enough recent activity to compose an edition yet. Check back after a few more bits.
    </p>
  );
  return <IssueRenderer issue={issue} />;
}
