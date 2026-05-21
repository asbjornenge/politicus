import { useEffect, useState } from 'react';
import { getKernelVars } from '../api';
import { KERNEL_VARS, groupedKernelVars, formatValue } from '../kernelVars';
import { Markdown } from './Markdown';

const PITCH = `
Politicus is a publishing platform built around a single, simple
invariant: **every piece of content carries cryptographic proof of who
created it, and every change to the platform itself is decided by signed,
costed votes from verified humans.**

It is not a replacement for X, Bluesky or Mastodon. It is built for
journalists, writers, researchers and political activists — people whose
work depends on the provenance of a statement more than on its reach.
`;

const HOW_IT_WORKS = `
### Signed content

Every post (called a **Bit**) is cryptographically signed by its author.
The bytes of the content live off-chain in content-addressed storage; only
the hash and signature live on chain. If you trust an author's key, no one
can publish on their behalf — and clients verify the signature locally
before rendering.

### Costed actions

Posting, voting and creating petitions all cost a small amount. This is
**anti-spam**, **pro-creator-revenue**, and **pro-deliberation**: it forces
actors to weigh what they do. Vote costs are quadratic — \`N\` votes
costs unit × \`N²\` — so concentrated influence gets expensive fast.

### Verified humans, no duplicates

Every account is bound to a proof-of-personhood via BrightID. One verified
person ↔ one account. No bots, no Sybil attacks at the registration layer.
(Currently a placeholder on Shadownet; production verification is the next
big milestone.)

### User-controlled kernel

Every economic and procedural parameter — costs, quorums, majorities,
voting durations — is a **kernel variable**. Users propose changes via
*petitions*. If a petition meets its quorum and majority within the open
window, the change is applied automatically. The platform is governed by
its users, not by an administrator.

During the bootstrap phase (while user count is below \`BootstrapUserThreshold\`)
the platform creator retains direct write access, but can only ratchet the
threshold *down*, never up. Once enough users have joined, this power
sunsets automatically.

### Moderation as signal, not erasure

Petitions can also moderate content or users. Moderation does **not**
erase the on-chain record — the hash and signature remain forever as
historical proof. What changes is that compliant indexers and gateways
stop serving the bytes, and clients hide moderated posts from feeds.
`;

const WHO_FOR = `
Politicus is aimed at people for whom **the source matters more than the
volume**:

- **Journalists** who want their bylines to be verifiable, especially in
  an age of deepfakes and content laundering.
- **Writers and essayists** who want a durable, portable publishing
  surface they don't depend on a platform owner to maintain.
- **Researchers** who want citation-grade provenance for primary sources.
- **Political activists** who need a record that can't be quietly
  rewritten or revoked.

If you mostly want to share memes and chat with friends, Twitter and the
fediverse already do that very well. Politicus is for the work that
matters when years pass.
`;

const LOGO = `
The logo tries to compress the entire identity into one mark, drawing on
three ideas:

**The seal.** The wax-seal medallion at the center says "signed and
verifiable" without screaming *crypto*. A seal has always been a proof of
origin, authority, and integrity — exactly what the platform promises for
any piece of content published on it.

**The herald's staff.** The winged staff rising through the seal is a
quiet nod to Mercurius, the messenger. It ties the brand back to
*Mercurius Politicus*, the 17th-century newsbook, without resorting to a
literal caduceus. It says: this is about messages, public record, and the
transmission of information.

**The column and the laurel.** The fluted column at the base anchors the
mark in classical institutions — law, forum, civic life, self-government.
The laurel branches add a heraldic, scholarly tone: dignity, authority,
endurance. Together they reflect a *user-governed publishing platform*,
not a social feed.

The **P / CP monogram** keeps the mark compact and favicon-friendly. It
reads as both Politicus and Curious Politicus, but the mark doesn't
depend on the full name to do its work.

The typography — broad Roman capitals, old-serif feel — reads as
*newsbook / broadsheet / institution* rather than *startup*. The ink
accents are deliberately restrained so the mark survives on a dark UI
without losing its ink-on-paper character.

The tagline **"Signed, civic, durable."** is the whole identity in three
words: signed content, civic governance, lasting credibility.
`;

const STATUS_AND_OPEN = `
Politicus is deployed on **Tezlink Shadownet** — the Michelson layer of
[Tezos X](https://tezos.com). The reference contracts (Variables, Treasury,
IdentityRegistry, BitRegistry, PetitionRegistry, ModerationRegistry) are
live, and the full governance loop has been validated end to end. Real
BrightID verification, a Beacon wallet integration, and the BitNFT
collectible layer are the next steps.

Everything is **open source** at
[github.com/asbjornenge/politicus](https://github.com/asbjornenge/politicus).
Anyone can run an indexer, write a client, or fork the kernel. The
canonical instance you're looking at is just one of many possible.
`;

export function AboutPage() {
  const [values, setValues] = useState<Record<string, string>>({});

  useEffect(() => {
    getKernelVars().then(setValues);
  }, []);

  const grouped = groupedKernelVars();

  return (
    <div>
      <section style={{ marginBottom: 24 }}>
        <h2 style={sectionHeading}>What is Politicus?</h2>
        <Markdown>{PITCH}</Markdown>
      </section>

      <section style={{ marginBottom: 24 }}>
        <h2 style={sectionHeading}>How it works</h2>
        <Markdown>{HOW_IT_WORKS}</Markdown>
      </section>

      <section style={{ marginBottom: 24 }}>
        <h2 style={sectionHeading}>Who it's for</h2>
        <Markdown>{WHO_FOR}</Markdown>
      </section>

      <section style={{ marginBottom: 24 }}>
        <h2 style={sectionHeading}>The kernel</h2>
        <p className="muted" style={{ marginTop: 0, marginBottom: 16 }}>
          Every parameter below is a kernel variable. Each can be changed by a
          successful petition. Current values are read live from the
          Variables contract.
        </p>
        {Object.entries(grouped).map(([group, vars]) => (
          <div key={group} className="bit" style={{ marginBottom: 12 }}>
            <h3 style={{ fontSize: 14, margin: '0 0 12px', color: 'var(--text)', textTransform: 'uppercase', letterSpacing: '0.08em' }}>{group}</h3>
            {vars.map((v, i) => {
              const raw = values[v.key];
              const isLast = i === vars.length - 1;
              return (
                <div
                  key={v.key}
                  style={{
                    marginBottom: isLast ? 0 : 14,
                    paddingBottom: isLast ? 0 : 12,
                    borderBottom: isLast ? 'none' : '1px solid var(--border)',
                  }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 12, flexWrap: 'wrap' }}>
                    <code style={{ fontSize: 13, color: 'var(--text)' }}>{v.key}</code>
                    <span style={{ fontSize: 12, color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>
                      {raw != null ? formatValue(BigInt(raw), v.unit) : <span className="muted">loading…</span>}
                    </span>
                  </div>
                  <div style={{ fontSize: 13, color: 'var(--text-muted)', marginTop: 4, lineHeight: 1.5 }}>
                    {v.description}
                  </div>
                </div>
              );
            })}
          </div>
        ))}
      </section>

      <section style={{ marginBottom: 24 }}>
        <h2 style={sectionHeading}>The logo</h2>
        <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 20 }}>
          <img src="/seal.png" alt="" width={280} height={280} />
        </div>
        <Markdown>{LOGO}</Markdown>
      </section>

      <section style={{ marginBottom: 24 }}>
        <h2 style={sectionHeading}>Status &amp; open source</h2>
        <Markdown>{STATUS_AND_OPEN}</Markdown>
      </section>
    </div>
  );
}

const sectionHeading: React.CSSProperties = {
  fontFamily: 'var(--font-display)',
  fontWeight: 400,
  letterSpacing: '0.14em',
  textTransform: 'uppercase',
  fontSize: 16,
  margin: '0 0 12px',
};
