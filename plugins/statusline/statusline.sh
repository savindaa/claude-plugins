#!/usr/bin/env bash
# Claude Code status line: account │ model effort │ output tok/s │ context │ cache │ cost · subagents' share │ plan usage (5h · 7d).
set -u

input=$(cat)
dir=${CLAUDE_CONFIG_DIR:-$HOME/.claude}
cache=$dir/cache/statusline
mkdir -p "$cache"

# Feeds the operator desk's Usage tab where that plugin is installed; a no-op elsewhere.
desk=$dir/marketplaces/operator-desk/plugin/bin/desk
[ -x "$desk" ] && { "$desk" report <<<"$input" >/dev/null 2>&1 & }
if [ -z "$(find "$cache/.swept" -mmin -60 2>/dev/null)" ]; then
  find "$cache" -name 'ctx-*.json' -mtime +7 -delete 2>/dev/null
  find "$cache" -name 'account-*.json' -mtime +7 -delete 2>/dev/null
  find "$cache" -name 'cost-*.json' -mtime +7 -delete 2>/dev/null
  find "$cache" -name 'speed-*.json' -mtime +7 -delete 2>/dev/null
  touch "$cache/.swept"
fi

sid=$(jq -r '.session_id // empty' <<<"$input")
ctx_file=$cache/ctx-$sid.json
usage_file=$cache/usage.json
now=$(date +%s)

# Plan limits arrive only with an API response; keep the last one for new sessions.
limits=$(jq -c '.rate_limits | objects | select(.five_hour or .seven_day)' <<<"$input" 2>/dev/null)
if [ -n "$limits" ] && [ "$limits" != "$(jq -c '.limits' "$usage_file" 2>/dev/null)" ]; then
  jq -cn --argjson now "$now" --argjson l "$limits" '{at: $now, limits: $l}' >"$usage_file.tmp" && mv "$usage_file.tmp" "$usage_file"
fi

# The plugin's hooks ask the server who the session's token is; the login record on disk may be another account.
# statusline-accounts.json maps an organization id to your own label: {"<org-uuid>": "work"}.
name=$(jq -rn --slurpfile acct <(cat "$cache/account-$sid.json" 2>/dev/null || echo null) \
  --slurpfile labels <(cat "$dir/statusline-accounts.json" 2>/dev/null || echo '{}') '
  ($acct[0]) as $a
  | if $a == null then ""
    elif ($a.name // $a.email) != null then ($a.name // $a.email)
    elif $a.org != null and $labels[0][$a.org] != null then $labels[0][$a.org]
    elif $a.org != null then "org " + $a.org[0:8]
    else "?" end')

jq -rn \
  --argjson in "$input" \
  --argjson now "$now" \
  --arg name "$name" \
  --slurpfile ctx <(cat "$ctx_file" 2>/dev/null || echo null) \
  --slurpfile usage <(cat "$usage_file" 2>/dev/null || echo null) \
  --slurpfile split <(cat "$cache/cost-$sid.json" 2>/dev/null || echo null) \
  --slurpfile speed <(jq -c . "$cache/speed-$sid.json" 2>/dev/null || echo null) '
  def pad2: tostring | if length < 2 then "0" + . else . end;
  def dur: (. / 60 | floor) as $m
    | if $m < 60 then "\($m)m"
      elif $m < 1440 then "\($m / 60 | floor)h\($m % 60 | pad2)m"
      else "\($m / 1440 | floor)d\(($m % 1440) / 60 | floor)h" end;
  def k: if . >= 1000000 then "\(. / 100000 | round / 10)M" else "\(. / 1000 | round)k" end;
  def money: (. * 100 | round) as $c | "\($c / 100 | floor).\($c % 100 | pad2)";

  def lerp($a; $b; $f): [range(3) as $i | $a[$i] + ($b[$i] - $a[$i]) * $f | round];
  def ramp($stops; $x): ($stops | length - 1) as $n
    | ([0, ([$x, 1] | min)] | max) as $x
    | ([($x * $n | floor), $n - 1] | min) as $i
    | lerp($stops[$i]; $stops[$i + 1]; $x * $n - $i);

  # Catppuccin Mocha palette.
  def slate: [108, 112, 134];
  def muted: [147, 153, 178];
  def heat($p): ramp([[148, 226, 213], [166, 227, 161], [249, 226, 175], [250, 179, 135], [235, 160, 172], [243, 139, 168]]; $p / 100);
  def family($m): ($m | ascii_downcase) as $m
    | if $m | test("opus") then [[245, 224, 220], [250, 179, 135]]
      elif $m | test("sonnet") then [[137, 220, 235], [116, 199, 236]]
      elif $m | test("haiku") then [[148, 226, 213], [166, 227, 161]]
      elif $m | test("fable") then [[242, 205, 205], [245, 194, 231]]
      else [[186, 194, 222], [166, 173, 200]] end;
  def effortColor($e): {low: [147, 153, 178], medium: [180, 190, 254], high: [203, 166, 247], xhigh: [245, 194, 231], max: [243, 139, 168]}[$e] // muted;

  def run($rgb): {t: ., from: $rgb, to: $rgb};
  def fade($from; $to): {t: ., from: $from, to: $to};
  def sep($s): $s | run(slate);

  ($ctx[0]) as $c
  | ($usage[0]) as $u
  | ($in.model.display_name // $in.model.id // "" | sub(" ?\\((?<w>[0-9.]+[MK]) context\\)"; " (\(.w))")) as $model
  | ($in.effort.level // "") as $effort
  | (if $c != null then {p: $c.percent, limit: $c.limit}
     elif $in.context_window.used_percentage != null then
       {p: ($in.context_window.used_percentage | round), limit: $in.context_window.context_window_size}
     else null end) as $cx
  | ($in.prompt_cache // null) as $pc
  | ($in.cost.total_cost_usd // 0) as $cost
  | ($split[0].agents // 0) as $agents
  | ($in.rate_limits // $u.limits // {}) as $limits
  | (if $in.rate_limits == null and $u != null then " (\($now - $u.at | dur) ago)" else "" end) as $age
  | [ ("five_hour", "seven_day") as $w
      | $limits[$w] | select(. != null and .resets_at > $now)
      | (.used_percentage | round) as $p
      | [("\($p)%" | run(heat($p))), ("/" | run(slate)), (.resets_at - $now | dur | run(muted))] ] as $plan
  | [ ($name | select(. != "") | [fade([180, 190, 254]; [203, 166, 247])]),
      ($model | select(. != "") | family(.) as $f | [fade($f[0]; $f[1])]
        + (if $effort != "" then [(" " | run(slate)), ($effort | run(effortColor($effort)))] else [] end)),
      ($speed[0].tps // empty | [("󰓅 " | run(muted)), (round | tostring | run([137, 180, 250]))]),
      ($cx // empty | . as $x | [("󰧑 " | run(muted)), ("\($x.p)%" | run(heat($x.p * 100 / 90))), ("/\($x.limit | k)" | run(slate))]),
      # The cache bills a rebuild once it expires, so redden over its last five minutes.
      ($pc // empty
        | if .warm and .expires_at != null then
            (.expires_at - $now) as $left
            | [("󰔟 " | run(muted)),
               (if $left < 60 then "<1m" else $left | dur end | run(heat((1 - ([$left / 300, 1] | min)) * 100)))]
            + (if .hit_ratio != null then (.hit_ratio * 100 | round) as $h | [sep(" · "), ("󰓾 " | run(muted)), ("\($h)%" | run(heat(100 - $h)))] else [] end)
          else [("󰔟 cold" | run(slate))] end),
      ($cost | select(. > 0)
        | [("󰇁 " | run(muted)), (money | fade([249, 226, 175]; [250, 179, 135]))]
        + (if $agents > 0 then [sep(" · "), ("󰚩 " | run(muted)), (if $agents < 0.01 then "<0.01" else $agents | money end | run([203, 166, 247]))] else [] end)),
      (if ($plan | length) > 0
       then $plan[0] + ($plan[1:] | map([sep(" · ")] + .) | add // []) + (if $age != "" then [$age | run(slate)] else [] end)
       else empty end) ]
  | [ .[0], (.[1:][] | [sep(" │ ")] + .) ] | add
  | map(. as $r | ($r.t | explode) as $cs | ($cs | length) as $n
      | [ range($n) as $i
          | lerp($r.from; $r.to; (if $n > 1 then $i / ($n - 1) else 0 end)) as $rgb
          | "\u001b[38;2;\($rgb[0]);\($rgb[1]);\($rgb[2])m\([$cs[$i]] | implode)" ] | join(""))
  | join("") + "\u001b[0m"'
