export type KernelVar = {
  key: string;
  group: string;
  unit: 'mutez' | 'bps' | 'seconds' | 'count';
  description: string;
};

export const KERNEL_VARS: KernelVar[] = [
  { key: 'BitCost', group: 'Action costs', unit: 'mutez',
    description: 'Cost to publish a Bit. Paid in mutez to Treasury at posting time.' },
  { key: 'BitVoteCost', group: 'Action costs', unit: 'mutez',
    description: 'Cost per Bit vote, quadratic — N votes costs unit × N² mutez.' },
  { key: 'PetitionContentModerationAddCost', group: 'Action costs', unit: 'mutez',
    description: 'Cost to create a petition that moderates a piece of content.' },
  { key: 'PetitionContentModerationDelCost', group: 'Action costs', unit: 'mutez',
    description: 'Cost to create a petition that un-moderates a piece of content.' },
  { key: 'PetitionUserModerationAddCost', group: 'Action costs', unit: 'mutez',
    description: 'Cost to create a petition that moderates a user.' },
  { key: 'PetitionUserModerationDelCost', group: 'Action costs', unit: 'mutez',
    description: 'Cost to create a petition that un-moderates a user.' },
  { key: 'PetitionUpdateVariableCost', group: 'Action costs', unit: 'mutez',
    description: 'Cost to create a petition that changes a kernel variable (this kind of petition).' },
  { key: 'PetitionUpdateKernelCost', group: 'Action costs', unit: 'mutez',
    description: 'Cost to create a petition that replaces the kernel contract code. Not yet implemented.' },
  { key: 'PetitionVoteCost', group: 'Action costs', unit: 'mutez',
    description: 'Cost per petition vote, quadratic — N votes costs unit × N² mutez.' },

  { key: 'PetitionContentModerationQuorum', group: 'Quorum thresholds', unit: 'bps',
    description: 'Minimum share of registered users who must vote on a content-moderation petition for it to be valid. 10000 bps = 100%.' },
  { key: 'PetitionUserModerationQuorum', group: 'Quorum thresholds', unit: 'bps',
    description: 'Same as content moderation quorum, but for user moderation.' },
  { key: 'PetitionUpdateVariableQuorum', group: 'Quorum thresholds', unit: 'bps',
    description: 'Quorum for variable-change petitions.' },
  { key: 'PetitionUpdateKernelQuorum', group: 'Quorum thresholds', unit: 'bps',
    description: 'Quorum for kernel-replacement petitions.' },

  { key: 'PetitionContentModerationMajority', group: 'Majority thresholds', unit: 'bps',
    description: 'Share of yay-over-total votes required to pass a content-moderation petition.' },
  { key: 'PetitionUserModerationMajority', group: 'Majority thresholds', unit: 'bps',
    description: 'Same as above, for user moderation.' },
  { key: 'PetitionUpdateVariableMajority', group: 'Majority thresholds', unit: 'bps',
    description: 'Majority for variable-change petitions.' },
  { key: 'PetitionUpdateKernelMajority', group: 'Majority thresholds', unit: 'bps',
    description: 'Majority for kernel-replacement petitions.' },

  { key: 'PetitionDuration', group: 'Time', unit: 'seconds',
    description: 'How long a petition is open for voting after creation, in seconds.' },

  { key: 'TreasuryFee', group: 'Treasury & NFT', unit: 'bps',
    description: 'Share of action fees routed to Treasury. 300 bps = 3%.' },
  { key: 'BitNFTPrimaryFee', group: 'Treasury & NFT', unit: 'bps',
    description: 'Treasury cut on BitNFT primary sales.' },
  { key: 'BitNFTSecondaryFee', group: 'Treasury & NFT', unit: 'bps',
    description: 'Treasury cut on BitNFT secondary sales.' },

  { key: 'BootstrapUserThreshold', group: 'Bootstrap', unit: 'count',
    description: 'Number of registered users at which bootstrap_admin powers sunset. The bootstrap admin can ratchet this DOWN but not up; petitions can change it freely.' },
];

export function groupedKernelVars() {
  const groups: Record<string, KernelVar[]> = {};
  for (const v of KERNEL_VARS) {
    (groups[v.group] ??= []).push(v);
  }
  return groups;
}

export function formatValue(value: bigint, unit: KernelVar['unit']): string {
  const n = Number(value);
  switch (unit) {
    case 'mutez': {
      const tez = n / 1_000_000;
      return `${n.toLocaleString()} mutez (= ${tez} tez)`;
    }
    case 'bps': {
      const pct = n / 100;
      return `${n} bps (= ${pct}%)`;
    }
    case 'seconds': {
      if (n >= 86400) return `${n}s (= ${(n / 86400).toFixed(1)} days)`;
      if (n >= 3600) return `${n}s (= ${(n / 3600).toFixed(1)} hours)`;
      if (n >= 60) return `${n}s (= ${(n / 60).toFixed(1)} min)`;
      return `${n}s`;
    }
    case 'count':
      return `${n}`;
  }
}
