import { describe, expect, it } from 'vitest';
import { parseMatches } from '../../../tools/steam.mjs';

// Shape of steamcommunity.com/profiles/<id>/gcpd/730?tab=matchhistorypremier (one scoreboard per match)
const ME = '76561198385186309'; // account id 424920581
const player = (acc: number, name: string) =>
  `<tr><td class="inner_name"><div class="playerAvatar"><a href="https://steamcommunity.com/id/${name}" data-miniprofile="${acc}"><img></a></div>`
  + `<div class="playerNickname ellipsis"><a class="linkTitle" href="https://steamcommunity.com/id/${name}">${name}</a></div></td><td>20</td><td>3</td><td>15</td></tr>`;
const match = (title: string, date: string, link: string | null, top: string, bottom: string, score: string) => `
<tr><td class="val_left"><table class="csgo_scoreboard_inner_left"><tbody>
  <tr><td>\n\t\t\t${title}\t\t</td></tr>
  <tr><td>\n\t\t\t${date}\t\t</td></tr>
  <tr><td>\n\t\t\tWait Time: 00:41\t\t</td></tr>
  <tr><td>\n\t\t\tMatch Duration: 41:23\t\t</td></tr>
  ${link ? `<tr><td class="csgo_scoreboard_cell_noborder"><a href="${link}"><div class="csgo_scoreboard_btn_gotv">Download GOTV Replay</div></a></td></tr>` : ''}
</tbody></table></td>
<td class="val_right"><table class="csgo_scoreboard_inner_right"><tbody>
  <tr><th class="inner_name">Player Name</th><th>Ping</th><th>K</th><th>A</th></tr>
  ${top}
  <tr><td colspan="8" class="csgo_scoreboard_score">${score}</td></tr>
  ${bottom}
</tbody></table></td></tr>`;
const page = `<html><script>g_steamID = "${ME}"; var g_sGcContinueToken = '3847999999999';</script>
<table class="generic_kv_table csgo_scoreboard_root"><tbody>
${match('Premier Ancient', '2026-10-14 19:02:11 GMT', 'http://replay192.valve.net/730/003847732607018074171_0422097200.dem.bz2', player(1, 'a') + player(424920581, 'me'), player(3, 'c'), '13 : 16')}
${match('Premier Dust II', '2026-08-01 10:00:00 GMT', null, player(5, 'e'), player(424920581, 'me'), '9 : 13')}
</tbody></table></html>`;

describe('steam match history page', () => {
  it('reads map, date, demo link, score and result from my side', () => {
    const ms = parseMatches(page, 'Premier', ME);
    expect(ms.length).toBe(2);
    const [a, b] = ms;
    expect(a.map).toBe('de_ancient');
    expect(a.time).toBe(Date.UTC(2026, 9, 14, 19, 2, 11));
    expect(a.url).toMatch(/replay192\.valve\.net\/730\/003847732607018074171_0422097200\.dem\.bz2$/);
    expect(a.id).toBe('003847732607018074171_0422097200');
    expect(a.scores).toEqual([13, 16]); // I'm in the top team
    expect(a.result).toBe('loss');
    expect(a.duration).toBe('41:23');
    expect(b.map).toBe('de_dust2');
    expect(b.url).toBeNull(); // expired: no download button
    expect(b.scores).toEqual([13, 9]); // I'm in the bottom team: my score first
    expect(b.result).toBe('win');
  });
});
