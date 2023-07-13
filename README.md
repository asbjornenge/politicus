# Curious Politicus (DRAFT)

Politicus is a social network and publishing platform.

**In Politicus you will find only cryptographically signed content**.  
That means that for any [key]() you come to trust, it will not be possible for anyone else act on their behalf.

> Is that video signed by anyone you trust? If not, it might be a deepfake. 

**Actions on Politicus have a cost**.  
By adding a cost to all actions in Politicus we assure that actors weigh their actions and avoid unecessary noise, bots, etc. 
We also create a source of revenue for content creators.

**Moderation on Policitus is user controlled.**  
Users are in charge of [moderation](). Any user can petition for the removal of any piece of content or user.

**Politicus itself is user controlled.**  
Politicus has a "constitution"; it's [kernel](). The kernel has [variables](). Users can peition to change variables and also to replace the kernel.

**Politicus is free and open**  
Politicus source code is open-source and free to use by anyone.

**Politicus is built to last**  
Built as a Rollup on the magnificent [Tezos](https://tezos.com) blockchain.

**The name Curious Politicus is inspired bt the 17th century newsbook Mercurious Politicus**  
[Mercurius Politicus](https://en.wikipedia.org/wiki/Mercurius_Politicus) was a newsbook that was published weekly from June 1650 until the English Restoration in May 1660.
We replaced the latin word Mercurious (messenger) and substitud the english word Curious. Politicus is a latin word for "political". We also take inspiration from the greek concept of "polis" which represented a self-governing community with its laws, institutions, and identity. So loosely you can say the the name "Curious Politicus" means "Curious about self-governing communities" or something like that. Also we think it is quite catchy.

## Bit 

A **Bit** is a piece of content on Politicus. We chose the word "Bit" because it is short, easy to say and remember.

> I just posted a Bit on Politicus.

A Bit has the following properties:

```
* BID           - hash(Creator + Content)
* Creator       - PublicKey 
* Content       - hash(content)
* Parent        - BID (if this BID is part of a conversation)
* CreationTime  - Timestamp 
```

## BitVote

A BitVote is a up/down vote for a Bit.

```
* PID       - hash(BID + Voter)
* Voter     - PublicKey
* Direction - Boolean (1=up, 0=down)
* Votes     - Number of votes (quadratic cost increase?)
```

## Petiton

## PetitionVote

## Variable

* BitCost - Cost to create a Bit
* BitVoteCost - Cost to vote for a Bit
* PetitionCost

## Kernel 

## Incentives

* Incentives to create Bits
* Incentives to vote on Bits
* Incentives to create Petitions
* Incentives to vote on Petitions

## Open questions

### How do we deal with "copyminting"?

If a bit (hash) is already created we do not allow it's creating again.
If a user believes he owns the rights to this bit, they can create a petition to have it removed.
After it has been removed, they can create it themselves.
The user can also petition to have the copyminter (user who created bit illegally) removed. 
