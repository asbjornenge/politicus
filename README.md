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

```
* PID           - hash(content)
* Type          - ENUM 
                (
                    + MOD_CONTENT_ADD - Add ModerationEntry for a piece of content
                    + MOD_CONTENT_DEL - Del ModerationEntry for a piece of content
                    + MOD_USER_ADD    - Add ModerationEntry for a User
                    + MOD_USER_DEL    - Del ModerationEntry for a User
                    + VARIABLES       - Modify variable
                    + KERNEL          - Update kernel
                )
* Creator       - PublicKey
* Content       - <JSON_MATCHING_ENUM> 
* CreationTime  - Timestamp
```

## PetitionVote

A PetitionVote is a up/down vote for a Petition.

```
* PVID      - hash(PID + Voter)
* Voter     - PublicKey
* Direction - Boolean (1=up, 0=down)
* Votes     - Number of votes (quadratic cost increase?)
* VoteTime  - Timestamp
```

## ModerationEntry

When a Petition to create some form of moderation (Content or User) a ModerationEntry is created.
The ModerationEntry prevents moderated content from being created and moderated users from using CP. 

```
* MID           - hash(content)
* Type          - ENUM 
                (
                    + CONTENT
                    + USER
                )
* Content       - <JSON_MATCHING_ENUM> 
* YaY           - Number of UP votes
* NaY           - Number of DOWN votes
* CreationTime  - Timestamp
```

## Variables

The different variable in the initial kernel / constitution.

```
* BitCost                                   - $ 1
* BitVoteCost                               - $ 0.1  (quadratic)
* PetitionContentModerationAddCost          - $ 500
* PetitionContentModerationDelCost          - $ 250  (function if already exists)
* PetitionUserModerationAddCost             - $ 1000
* PetitionUserModerationDelCost             - $ 500  (function if already exists)
* PetitionUpdateVariableCost                - $ 2500
* PetitionUpdateKernelCost                  - $ 5000
* PetitionVoteCost                          - $ 0.5  (quadratic)
* PetitionContentModerationQuorum           - % 1
* PetitionUserModerationQuorum              - % 2
* PetitionUpdateVariableQuorum              - % 40
* PetitionUpdateKernelQuorum                - % 50
* PetitionContentModerationMajority         - % 1
* PetitionUserModerationMajority            - % 2
* PetitionUpdateVariableMajority            - % 80
* PetitionUpdateKernelMajority              - % 90
* PetitionDuration                          - d 30
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
* After a petition has been voted for, how long until it can be re-created? A variable?
* Should we expand User from just a publickey - perhaps they can have multiple?
* Should we have different costs for different Petition types?
* Should we have different vote weights (3/4 majority) for different Petition types? <- YES (Kernel should require atleast 3/4)
* Should we require min participation for Petitions?
  * Atleast kernel?
  * It's probably a good idea to make sure people care about this petition?
  * Leaning towards yes - but it can be a variable
* Should we allow blank votes?
 
