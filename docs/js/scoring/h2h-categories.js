// H2H 類別制：每個計分類別比大小，贏的類別數 - 輸 - 平，例如 6-4-0
export const id = 'head';
export const label = 'H2H 類別制';
export const implemented = true;

// 只接受純數字字串（"12"、".275"、"3.45"）；"-"、""、"12/34" 都視為無法比較
export function parseNum(v) {
  if (v == null) return null;
  const s = String(v).trim();
  if (!/^-?(\d+\.?\d*|\.\d+)$/.test(s)) return null;
  return Number(s);
}

function decimals(v) {
  const m = String(v ?? '').match(/\.(\d+)$/);
  return m ? m[1].length : 0;
}

export function formatDiff(a, b) {
  const x = parseNum(a);
  const y = parseNum(b);
  if (x === null || y === null) return '';
  const d = Math.max(decimals(a), decimals(b));
  let s = Math.abs(x - y).toFixed(d);
  // 打擊率這類 ".275" 格式的數字，差距也寫成 ".012"
  if (String(a).trim().startsWith('.') || String(b).trim().startsWith('.')) s = s.replace(/^0\./, '.');
  return s;
}

// 單一類別：回傳 'win' | 'loss' | 'tie' | null（無法判斷）
export function judge(a, b, higherBetter) {
  const x = parseNum(a);
  const y = parseNum(b);
  if (x === null || y === null) return null;
  const d = Math.max(decimals(a), decimals(b));
  const eps = 0.5 * 10 ** -d;
  if (Math.abs(x - y) < eps) return 'tie';
  return (x > y) === higherBetter ? 'win' : 'loss';
}

// categories: parseSettings().categories
// matchup:    findMyMatchup() 的結果（teams[0] 是我方）
export function compute({ categories, matchup }) {
  const [me, opp] = matchup.teams;
  const record = { win: 0, loss: 0, tie: 0 };
  const rows = categories.map((c) => {
    const my = me?.stats[c.id];
    const op = opp?.stats[c.id];
    const row = { ...c, my: my ?? '-', opp: op ?? '-', result: 'display', diff: '' };
    if (c.displayOnly) return row;

    let r = judge(my, op, c.higherBetter);
    if (r === null) {
      // 數值無法比較（例如雙方都還沒投球的 ERA）時，採用 Yahoo 自己的判定
      const w = matchup.statWinners?.[c.id];
      if (w === 'tie') r = 'tie';
      else if (w && me) r = w === me.key ? 'win' : 'loss';
    }
    row.result = r ?? 'na';
    row.diff = formatDiff(my, op);
    if (r) record[r] += 1;
    return row;
  });
  return {
    me,
    opp,
    rows,
    record,
    recordText: `${record.win}-${record.loss}-${record.tie}`,
  };
}
