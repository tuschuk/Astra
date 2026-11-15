# Astra content policy

Astra is a place to log training, share it, and push each other to get stronger. This page says
what belongs here, what gets removed, and how reporting works. It applies to everything you post:
workouts, photos, comments, your profile name, bio and photo.

Astra is for adults. You must be 18 or older to have an account.

## How moderation works

- **Reporting.** Every post and every comment by someone else has a ⋯ button. Pick the reason
  that fits (the six reasons below), add details if they help, and send. The person you report
  is never told who reported them. Reporting the same thing twice counts once.
- **Review.** At launch, reports are reviewed by Astra's founder, against this page. Not every
  report leads to removal — a report is a request for a look, and the decision is a judgement
  call.
- **What can happen.** A post or comment that breaks these rules can be removed. An account that
  breaks them seriously or repeatedly can be closed, which deletes everything in it.
- **Mute and block.** You don't need a report to stop seeing someone. From their profile:
  - **Mute** hides their posts, workouts and comments from you. They aren't told, and you keep
    following them. Unmute any time.
  - **Block** hides you from each other completely and removes follows both ways. They aren't
    told. Unblock any time (follows don't come back on their own).
  - To report something, report it first — once you mute or block someone, their content is
    hidden from you, so there is nothing left to report.
- **Disagree with a decision?** Appeals go to the founder by email, naming the post or account
  it's about; every appeal is read. The appeal address is not published yet — it will be added
  here, and linked from the app, before Astra opens to the public.

## What gets removed

Each section below is one of the report reasons in the app, in the same words.

### Spam

Ads, scams, links that exist to sell something, or the same thing posted over and over. Sharing
a program or a product you genuinely use is fine; turning your feed into a billboard isn't.

### Harassment

Bullying, threats, hate, or targeting someone. That includes mocking someone's body or lifts,
slurs, attacks on someone for who they are, posting someone's private information, and piling
on. Disagreeing about training is fine; going after the person isn't.

### Nudity or sexual content

Explicit or sexual images or words. Progress pics are welcome — training clothes, shirtless or
in a sports bra is fine. Nudity, sexual poses or sexual comments are not. Physique Check posts
take upvotes only, so nobody can pile downvotes on someone's body.

### Not about training

Nothing to do with lifting, training, the gym or the people in it. Astra stays useful because
the feed stays about training.

### Impersonation

Pretending to be someone else — another lifter, a coach, a gym, a brand, or a public figure.
Parody is fine only if it is obvious.

### Something else

Illegal, dangerous, or otherwise against the rules. That includes selling or promoting illegal
substances, encouraging self-harm or dangerous practices, sharing someone else's content as
your own, and anything involving minors.

## Keeping this page honest

The report reasons in the app (`frontend/src/social/moderation.ts`), the list the database
accepts (the `reports.reason` check in `backend/supabase/migrations/…_moderation.sql`) and the
six sections above are the same six things. Change them together.
