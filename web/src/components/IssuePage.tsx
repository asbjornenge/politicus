import { useEffect, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { Newspaper, Building2 } from 'lucide-react';
import type { IssueDetail } from '../api';
import { getIssue } from '../api';
import { formatBitDate } from '../utils';

export function IssuePage() {
  const { id } = useParams<{ id: string }>();
  const [issue, setIssue] = useState<IssueDetail | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!id) return;
    setLoading(true);
    getIssue(id).then(setIssue).finally(() => setLoading(false));
  }, [id]);

  if (loading) return <p className="muted">loading…</p>;
  if (!issue) return <p className="muted">issue not found.</p>;
  return <IssueRenderer issue={issue} />;
}

export function IssueRenderer({ issue }: { issue: IssueDetail }) {
  const { layout_json: layout, bits } = issue;
  return (
    <div className="issue">
      <header className="issue-header">
        <div className="muted issue-eyebrow">
          <Newspaper size={12} style={{ verticalAlign: 'middle', marginRight: 4 }} />
          POLITICUS
        </div>
        <h1 className="issue-title">{layout.title}</h1>
        <div className="issue-meta">
          {new Date(issue.time_window_start).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}
          {' – '}
          {new Date(issue.time_window_end).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}
          {issue.filter_query && <span> · search: "{issue.filter_query}"</span>}
        </div>
        <hr className="issue-rule" />
        {layout.intro && <p className="issue-intro">{layout.intro}</p>}
      </header>

      {layout.lead && bits[layout.lead.bit_id] && (
        <LeadArticle headline={layout.lead.headline} bit={bits[layout.lead.bit_id]} />
      )}

      {layout.sections?.map((sec, i) => (
        <section key={i} className="issue-section">
          <h2 className="issue-section-name">{sec.name}</h2>
          <div className="issue-columns">
            {sec.items.map((it, j) => bits[it.bit_id] && (
              <SectionItem key={j} headline={it.headline} bit={bits[it.bit_id]} />
            ))}
          </div>
        </section>
      ))}

      <footer style={{ marginTop: 40, fontSize: 11, color: 'var(--text-faint)', borderTop: '1px solid var(--border)', paddingTop: 12 }}>
        Composed {new Date(issue.created_at).toLocaleString()} by AI editor. Headlines summarise bit content;
        original signed text linked from each article.
      </footer>
    </div>
  );
}

function LeadArticle({ headline, bit }: { headline: string; bit: any }) {
  const excerpt = (bit.content ?? '').slice(0, 400);
  return (
    <Link to={`/bit/${bit.bid}`} className="issue-lead">
      <h2 className="issue-lead-headline">{headline}</h2>
      <Byline bit={bit} />
      <p className="issue-lead-excerpt">{excerpt}{excerpt.length >= 400 ? '…' : ''}</p>
    </Link>
  );
}

function SectionItem({ headline, bit }: { headline: string; bit: any }) {
  const excerpt = (bit.content ?? '').replace(/\s+/g, ' ').slice(0, 180);
  return (
    <Link to={`/bit/${bit.bid}`} className="issue-item">
      <h3 className="issue-item-headline">{headline}</h3>
      <Byline bit={bit} />
      <p className="issue-item-excerpt">{excerpt}{excerpt.length >= 180 ? '…' : ''}</p>
    </Link>
  );
}

function Byline({ bit }: { bit: any }) {
  return (
    <div className="issue-byline">
      {bit.syndicate ? (
        <>
          <Building2 size={11} /> {bit.syndicate_name ?? 'syndicate'}{' '}
          <span className="muted">by {bit.creator_username ?? bit.creator.slice(0, 8)}</span>
        </>
      ) : (
        <span>by {bit.creator_username ?? bit.creator.slice(0, 12) + '…'}</span>
      )}
      <span className="muted"> · {formatBitDate(bit.creation_time)}</span>
    </div>
  );
}
