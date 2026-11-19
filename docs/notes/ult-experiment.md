# Deadlock fight model: ultimates ready (not shipped)

Tested Nov 2026 (`npm run dl:fight`, demos read by `npm run dl:ults`): does knowing which heroes in a fight have their
ultimate ready, 12 s before it, help predict who wins?

On 1,095 test fights from 311 matches with demos, as a correction on top of the fight model:

| Model | Log loss | Right |
|---|---|---|
| Without ultimates (in use) | 0.5808 | 69.8% |
| + how many ready | 0.5840 | 70.0% |
| + how many, and area / control / protect | 0.5852 | 69.6% |

Each ultimate ready added about +0.03 log-odds: once numbers, health, souls and help are known, ultimates ready barely
change who wins. So it's not shipped; how ultimates are *used* is judged instead (Match recap, `ultUse.ts`).
`dl:fight` re-runs the comparison every patch and ships the correction by itself if it ever beats the model.
