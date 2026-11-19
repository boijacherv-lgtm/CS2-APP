# What to measure (round 8, F)

Targets are guesses until real counts exist; check monthly, one snapshot proves little.

- **North star:** recaps opened per week.
- **Funnel:** visit → review started → grading finished → recap opened → shared. Target: 40% of review starts reach the recap.
- **Quality:** recap grading time p50 < 60 s · client errors < 1% of sessions · coach agreement with the owner's rulings ≥ 90%
  (the nightly check already reports this one: Dev → Coach).
- **Habit:** daily puzzle completion · players back within 7 days ≥ 25%.
- **Trust:** disputes per 100 reviews (falling = the coach improving).

Needs before any of these can be counted: a cookieless counter (Cloudflare Web Analytics, free, set up on the Cloudflare
account) or Worker counters (KV's free plan has 1,000 writes a day, so counts would have to be sampled), and a Privacy
line saying what is counted. Today only the coach agreement and puzzle answers are measured.
