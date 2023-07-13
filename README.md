# Curious Politicus (DRAFT)

Curious Politicus (CP) is a social network and publishing platform.

*In more detail, you can say it is an attempt to create a proper incentive structure for a self-governing social media network that will lead to positive outcomes for humanity.*

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
* VID       - hash(BID + Voter)
* Voter     - PublicKey
* Direction - Boolean (1=up, 0=down)
* Votes     - Number of votes (quadratic cost increase?)
* VoteTime  - Timestamp
```

## Petiton

A Petiton is a request to change some aspect of CP. There are a few different types of petitions.

**NOTE! We should store moderation items, right? So content cannot just be re-created and user just re-join. If yes, then we need moderation removal petitions. They should be cheaper than the ones to create moderation...? Think about this...**

### ContentModerationPetition

A ContentModerationPetition is a Petition to have some piece of content removed.

```
* PID           - hash('petition'+Bit.content)
* Creator       - PublicKey
* Content       - Bit.content
* CreationTime  - Timestamp 
```

### ContentModerationRemovalPetition 

A ContentModerationRemovalPetition is a Petition to remove a previously created content moderation.

```
* PID           - hash('petition'+Bit.content)
* Creator       - PublicKey
* Content       - Bit.content
* CreationTime  - Timestamp 
```

### ModerateUserPetition

A ModerateUserPetition is a Petition to remove a user (and all of their Bits).

```
* PID     - hash(BID + Creator)
* Creator - PublicKey
* User    - PublicKey
```

### ChangeVariablePetition

### UpdateKernelPetition

## PetitionVote

## Variables

```
* BitCost                               - Cost to create a Bit                                      - $ 1
* BitVoteCost                           - Cost to vote for a Bit                                    - $ 0.1
* PetitionContentModerationCost         - Cost to create a petition to moderate a piece of content  - $ 500
* PetitionContentModerationRemovalCost  - Cost to create a petition to remove a content moderation  - $ 250

* PetitionTimeout  - 
* PetitionCooldown - 
```

## Kernel 

## Incentives

* Incentives to create Bits
* Incentives to vote on Bits
* Incentives to create Petitions
* Incentives to vote on Petitions

## Open questions

### How do we deal with bots? 

### How do we deal with "copyminting"?

If a user believes he owns the rights to the `content` of a Bit, they can create a petition to have it removed.
The user can also petition to have the copyminter (user who created bit illegally) removed.

### How do we deal with fake content?

### How do we deal with illegal content?

How can we prevent illegal content for re-appearing?

## Notes

* What about topics? Should that just be parsed by indexers from hashtags in Bit.content?
