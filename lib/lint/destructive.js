import { effectiveRole, pathText, UNKNOWN } from './model.js';
import { confirmDestructive } from './fixes.js';

/*
 * destructive-action-confirmation
 *
 * A control that permanently destroys data or state (delete, purge, "dismiss permanently",
 * "don't show again", ...) must let the user confirm the intent first (WCAG 3.3.4 / 3.3.6).
 * Every common, accessible confirmation pattern is accepted:
 *   1. Modal confirmation   — the control sits inside <dialog>, role="dialog"/"alertdialog",
 *                             or a *Modal/*Dialog component (e.g. <HdsModal>), or its handler
 *                             opens one (showModal(), this.showDeleteModal = true, …).
 *   2. Inline confirmation  — the control is rendered by {{#if this.isConfirming}}…, or its
 *                             handler arms such a state that the template branches on.
 *   3. Native confirm       — window.confirm(...) in the handler, or onclick="return confirm(…)".
 *   4. Confirm-named flow   — handlers whose leading verb is confirm/ask/request/prompt/arm/…
 *                             (confirmDelete, askToDelete, openDeleteModal), not revokeTask.
 *   4b. Type-to-confirm     — a "type the name to confirm" field gating a disabled submit button.
 *   5. Reversible (undo)    — the handler offers undo/restore, so the action is not permanent.
 *   6. Navigation           — links (<a href>, <LinkTo>) to a confirmation page are not flagged.
 */

const STRONG_TEXT = /\b(delete|destroy|permanent(?:ly)?|forever|purge|erase|wipe|revoke|terminate|empty (?:the )?trash|(?:don'?t|do not|never) (?:show|remind)[\w ]*again)\b/i;
const WEAK_TEXT = /\b(remove|discard|clear all|reset|uninstall|deactivate)\b/i;
const STRONG_HANDLER = /(delete|destroy|purge|erase|wipe|revoke|terminate|permanent|forever|nevershow|dontshow)/i;
const WEAK_HANDLER = /(remove|discard|clearall|reset|uninstall|deactivate)/i;
// Leading verbs of a handler that starts a confirmation flow: confirmDelete, askToDelete, armDelete, requestRevoke, …
const CONFIRM_VERBS = new Set(['confirm', 'prompt', 'ask', 'request', 'verify', 'arm', 'begin', 'start', 'stage', 'initiate']);
const OPEN_VERBS = new Set(['open', 'show', 'launch', 'display', 'toggle', 'trigger']);
const CONFIRM_NOUNS = new Set(['modal', 'dialog', 'confirm', 'confirmation', 'prompt']);
// Handlers named for saving a form/setting (onSubmitAutoDestroy, saveAutoDelete): the destructive word is the setting's name.
const SETTING_VERBS = new Set(['submit', 'save', 'update', 'set', 'apply', 'toggle', 'edit', 'change']);
const LEADING_FILLER = new Set(['on', 'handle', 'do', 'perform', 'run']);
// Template condition words that mean "the user is in the confirm step".
const CONFIRM_STATE_WORDS = new Set(['confirm', 'confirming', 'confirmation', 'confirmed', 'sure', 'verify', 'verifying', 'armed', 'really', 'prompt', 'prompting', 'modal', 'dialog', 'undo']);
const DESTRUCTIVE_WORDS = /^(delete|deletion|deleting|remove|removal|removing|destroy|destroying|revoke|revocation|revoking|purge|purging|erase|wipe)$/;
// Handler-body evidence of a confirmation step. Closing/hiding a modal is deliberately not evidence.
const CONFIRM_BODY = [
  /\bconfirm\s*\(/, // window.confirm(), confirm(), this.modal.confirm()
  /\bprompt\s*\(/,
  /\bshowModal\s*\(/,
  /\b(?:open|show|launch|display)\w*(?:Modal|Dialog|Confirm\w*|Prompt)\s*\(/,
  /\b(?:modals?|dialogs?|confirm\w*|prompts?)\s*\.\s*(?:open|show|prompt|confirm|ask|perform|linked|unlinked|request)\b/i,
  /\bawait\s+[\w$.]*\b(?:prompt|confirm|ask)\w*\s*\(/i,
  /\bundo\b/i,
  /\brestore\b/i,
  /\bare ?you ?sure\b/i,
];
const TRUTHY_ASSIGN = /this\.(\w+)\s*=(?![=>])(?!\s*(?:false|null|undefined|0)\b|\s*(?:''|""|``))/g;
const DESTRUCTIVE_CALL = /\b(?:destroyRecord|deleteRecord|unloadRecord)\b|\.(?:delete|destroy|remove|purge|revoke|erase|wipe)\w*\s*\(|method:\s*['"]DELETE/i;
const TYPE_TO_CONFIRM = /\b(?:type|enter|re-?type|input)\b[^.!?]{0,80}?\bto (?:confirm|continue|proceed)\b|\bconfirm by typing\b/i;
const DIALOG_COMPONENT = /(modal|dialog|confirm)/i;
const HANDLER_ARGS = new Set(['@onclick', '@ondismiss']);
const CHAIN_HELPERS = new Set(['fn', 'action', 'perform', 'queue', 'optional', 'pick', 'stop-propagation', 'prevent-default']);

/** camelCase / snake_case words, lower-cased: "handleDeleteTask" → ["handle", "delete", "task"]. */
function words(name) {
  return String(name)
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
    .split(/[^A-Za-z0-9]+/)
    .filter(Boolean)
    .map((w) => w.toLowerCase());
}

/** Words of a handler name without leading on/handle/do: "onConfirmDelete" → ["confirm", "delete"]. */
function verbWords(name) {
  const w = words(name);
  while (w.length > 1 && LEADING_FILLER.has(w[0])) w.shift();
  return w;
}

/** confirmDelete, askToDelete, requestRevoke, openDeleteModal … — but not revokeTask, purgeAlarms, closeModal. */
function nameStartsConfirmation(name) {
  const w = verbWords(name);
  if (CONFIRM_VERBS.has(w[0])) return true;
  return OPEN_VERBS.has(w[0]) && w.some((x) => CONFIRM_NOUNS.has(x));
}

const isSettingHandler = (name) => SETTING_VERBS.has(verbWords(name)[0]);

/** First this.x / @x reference in a handler expression: "fn this.remove item" → "this.remove". */
function handlerRef(expr) {
  for (const tok of String(expr ?? '').split(/\s+/)) {
    if (CHAIN_HELPERS.has(tok)) continue;
    if (/^(this\.|@)?[A-Za-z_$][\w$]*(\.[\w$]+)*$/.test(tok) && !/^(true|false|null|undefined)$/.test(tok)) return tok;
  }
  return null;
}

function handlers(el) {
  const out = [];
  for (const m of el.modifiers) {
    if (m.name === 'on' && ['click', 'submit'].includes(m.params[0])) out.push(pathText(m.node.params[1]));
    if (m.name === 'action') out.push(m.node.params.map(pathText).join(' '));
  }
  for (const a of el.args()) if (HANDLER_ARGS.has(a.name.toLowerCase()) && a.path) out.push(a.path);
  const onclick = el.get('onclick');
  if (onclick) out.push(onclick.kind === 'static' ? onclick.value : '');
  return out;
}

function staticText(el, depth = 0, maxDepth = 6) {
  if (depth > maxDepth) return '';
  const parts = [];
  for (const k of ['aria-label', 'title', 'value']) if (el.value(k) && el.value(k) !== UNKNOWN) parts.push(el.value(k));
  for (const a of el.args()) if (['@text', '@label', '@title', '@ariaLabel'].includes(a.name) && a.value) parts.push(a.value);
  for (const c of el.content) {
    if (c.type === 'text') parts.push(c.text);
    else if (c.type === 'element') parts.push(staticText(c.el, depth + 1, maxDepth));
  }
  return parts.join(' ').replace(/\s+/g, ' ').trim();
}

const isFormLike = (el) => el.lowerTag === 'form' || (el.kind === 'component' && /Form$/.test(el.tag));
const isSubmitButton = (el) => el.value('type') === 'submit' || (el.lowerTag === 'button' && el.value('type') === null);

/* ---- Minimal JS scanning: enough to find a handler's function body. ---- */

/** If s[i] starts a string or comment, return the index just past it; otherwise i. */
function skipNonCode(s, i) {
  const c = s[i];
  if (c === '/' && s[i + 1] === '/') {
    const e = s.indexOf('\n', i);
    return e < 0 ? s.length : e;
  }
  if (c === '/' && s[i + 1] === '*') {
    const e = s.indexOf('*/', i + 2);
    return e < 0 ? s.length : e + 2;
  }
  if (c === '"' || c === "'" || c === '`') {
    for (let j = i + 1; j < s.length; j++) {
      if (s[j] === '\\') j++;
      else if (s[j] === c) return j + 1;
    }
    return s.length;
  }
  return i;
}

/** Index of the bracket matching the opener at s[i] (or -1). */
function matchBracket(s, i) {
  const pairs = { '(': ')', '[': ']', '{': '}' };
  const stack = [];
  for (let j = i; j < s.length; ) {
    const k = skipNonCode(s, j);
    if (k !== j) {
      j = k;
      continue;
    }
    const c = s[j];
    if (pairs[c]) stack.push(pairs[c]);
    else if (c === ')' || c === ']' || c === '}') {
      if (stack.pop() !== c) return -1;
      if (!stack.length) return j;
    }
    j++;
  }
  return -1;
}

const skipWs = (s, i) => {
  while (i < s.length && /\s/.test(s[i])) i++;
  return i;
};

/** Body of an arrow function whose `=>` ends at i: a {block} or a concise expression. */
function arrowBody(s, i) {
  i = skipWs(s, i);
  if (s[i] === '{') {
    const e = matchBracket(s, i);
    return e < 0 ? s.slice(i) : s.slice(i, e + 1);
  }
  let depth = 0;
  for (let j = i; j < s.length; ) {
    const k = skipNonCode(s, j);
    if (k !== j) {
      j = k;
      continue;
    }
    const c = s[j];
    if ('([{'.includes(c)) depth++;
    else if (')]}'.includes(c)) {
      if (depth-- === 0) return s.slice(i, j);
    } else if ((c === ',' || c === ';') && depth === 0) return s.slice(i, j);
    j++;
  }
  return s.slice(i);
}

/** Start index of the last top-level argument of the call whose `(` is at `open`. */
function lastArgStart(s, open, close) {
  let start = open + 1;
  let depth = 0;
  for (let j = open + 1; j < close; ) {
    const k = skipNonCode(s, j);
    if (k !== j) {
      j = k;
      continue;
    }
    const c = s[j];
    if ('([{'.includes(c)) depth++;
    else if (')]}'.includes(c)) depth--;
    else if (c === ',' && depth === 0 && s.slice(j + 1, close).trim()) start = j + 1;
    j++;
  }
  return start;
}

/**
 * Function body of the expression starting at i: a function/arrow, or the last function
 * argument of a call such as task({ drop: true }, async () => {…}) or task(this, function* () {…}).
 */
function bodyFromExpr(s, i, depth = 0) {
  if (depth > 4) return null;
  i = skipWs(s, i);
  const asyncM = /^async\b\s*/.exec(s.slice(i, i + 12));
  if (asyncM) i += asyncM[0].length;
  if (/^function\b/.test(s.slice(i, i + 9))) {
    const open = s.indexOf('(', i);
    const close = open < 0 ? -1 : matchBracket(s, open);
    const brace = close < 0 ? -1 : s.indexOf('{', close);
    if (brace < 0) return null;
    const e = matchBracket(s, brace);
    return e < 0 ? s.slice(brace) : s.slice(brace, e + 1);
  }
  if (s[i] === '(') {
    const close = matchBracket(s, i);
    if (close < 0) return null;
    const j = skipWs(s, close + 1);
    const ret = /^:\s*[^=]*?(?==>)/.exec(s.slice(j, j + 200)); // TS return type
    const k = ret ? j + ret[0].length : j;
    return s.startsWith('=>', k) ? arrowBody(s, k + 2) : null;
  }
  const id = /^[A-Za-z_$][\w$]*(?:\s*\.\s*[A-Za-z_$][\w$]*)*/.exec(s.slice(i));
  if (!id) return null;
  let j = skipWs(s, i + id[0].length);
  if (s.startsWith('=>', j)) return arrowBody(s, j + 2);
  if (s[j] === '<') {
    const gt = s.indexOf('>', j); // generic call: task<…>(…)
    if (gt > 0) j = skipWs(s, gt + 1);
  }
  if (s[j] !== '(') return null;
  const close = matchBracket(s, j);
  if (close < 0) return null;
  return bodyFromExpr(s, lastArgStart(s, j, close), depth + 1);
}

/**
 * Body of `name` in the component script: class method (incl. `@action async`, generator
 * `*name()` / `@task *name()`), arrow or function class field, ember-concurrency
 * `name = task(…)` / `dropTask(…)` / `task(this, …)`, object property, or function declaration.
 */
function methodBody(script, name) {
  if (!script || !name) return null;
  const esc = name.replace(/[$]/g, '\\$');
  const re = new RegExp(`(?<![\\w$.])${esc}\\s*(=(?![=>])|\\(|:(?!:))`, 'g');
  for (let m; (m = re.exec(script)); ) {
    const after = m.index + m[0].length;
    if (m[1][0] === '(') {
      const open = script.indexOf('(', m.index + name.length);
      const close = matchBracket(script, open);
      if (close < 0) continue;
      let j = skipWs(script, close + 1);
      if (script[j] === ':') {
        // TS return type: (…): Promise<void> {
        const brace = script.indexOf('{', j);
        const semi = script.indexOf(';', j);
        if (brace < 0 || (semi >= 0 && semi < brace)) continue;
        j = brace;
      }
      if (script[j] !== '{') continue; // a call, not a definition
      const e = matchBracket(script, j);
      return e < 0 ? script.slice(j) : script.slice(j, e + 1);
    }
    let start = after;
    if (m[1] === ':') {
      // `name: Type = task(…)` (TS field) or `name: function () {…}` (object property)
      const rest = script.slice(after, after + 200);
      const typed = /^[^=;{}()]*=(?![=>])/.exec(rest);
      if (typed && !/^\s*(?:async\b|function\b|\()/.test(rest)) start = after + typed[0].length;
    }
    const body = bodyFromExpr(script, start);
    if (body !== null) return body;
  }
  return null;
}

/** Tokens of a block condition, and whether the element sits in its truthy branch. */
function parseCondition(c) {
  const m = /^(else\s+)?([\w-]+)\s*(.*)$/.exec(c);
  if (!m) return { positive: false, tokens: [] };
  const [, neg, kw, expr] = m;
  const positive = (kw === 'if' && !neg) || (kw === 'unless' && Boolean(neg));
  return { positive, tokens: expr.split(/[\s()]+/).filter(Boolean) };
}

/** Does a condition token read as a confirming state (isConfirming, showDeleteModal, pendingDeletion, "confirm")? */
function confirmingToken(tok) {
  const w = words(tok.split('.').pop());
  if (w.some((x) => CONFIRM_STATE_WORDS.has(x))) return true;
  return w.some((x, i) => x === 'pending' && (DESTRUCTIVE_WORDS.test(w[i + 1] ?? '') || DESTRUCTIVE_WORDS.test(w[i - 1] ?? '')));
}

function isDialogEl(e) {
  if (e.lowerTag === 'dialog') return true;
  const role = e.isHtml ? effectiveRole(e) : null;
  if (role === 'dialog' || role === 'alertdialog') return true;
  return e.kind === 'component' && DIALOG_COMPONENT.test(e.tag);
}

/**
 * Setting `prop` truthy arms a confirmation only if the template's truthy branch on `prop`
 * holds a dialog or another actionable control (Confirm/Cancel) — not just "Deleting…" text.
 */
function armsConfirmation(prop, ctx, ownRefs) {
  return ctx.all.some((e) => {
    if (!e.conditions?.some((c) => {
      const p = parseCondition(c);
      return p.positive && p.tokens.includes(prop);
    })) return false;
    if (isDialogEl(e)) return true;
    const refs = handlers(e).map(handlerRef).filter(Boolean);
    return refs.length > 0 && refs.some((r) => !ownRefs.includes(r));
  });
}

/** Does the handler (or a this.method it calls, one level deep) show a confirmation step? */
function analyzeHandler(ref, ctx, ownRefs) {
  const name = ref.replace(/^this\.|^@/, '').split('.').pop();
  if (nameStartsConfirmation(name)) return { confirmed: true };
  if (ref.startsWith('@') || ref.startsWith('this.args.')) return { delegated: true };
  if (!ref.startsWith('this.')) return { yielded: true }; // yielded by an enclosing block, e.g. CF.delete
  const body = methodBody(ctx.script, name);
  if (body === null) return { unknown: true };
  const bodies = [body];
  for (const m of body.matchAll(/this\.(\w+)\s*(?:\(|\.\s*(?:perform|linked|unlinked)\b)/g)) {
    const inner = methodBody(ctx.script, m[1]);
    if (inner && inner !== body) bodies.push(inner);
  }
  const all = bodies.join('\n');
  if (CONFIRM_BODY.some((re) => re.test(all))) return { confirmed: true };
  for (const m of all.matchAll(TRUTHY_ASSIGN)) {
    const w = words(m[1]);
    // this.showDeleteModal = true / this.isConfirming = true
    if (!['close', 'hide', 'dismiss'].includes(w[0]) && w.some((x) => CONFIRM_STATE_WORDS.has(x) && x !== 'undo')) return { confirmed: true };
  }
  // Arms state that the template branches on into a dialog or inline confirmation.
  if (!DESTRUCTIVE_CALL.test(body)) {
    for (const m of body.matchAll(TRUTHY_ASSIGN)) if (armsConfirmation(`this.${m[1]}`, ctx, ownRefs)) return { confirmed: true };
  }
  if (/this\.args\.\w+(?:\s*\.\s*(?:perform|(?:un)?linked\(\)\s*\.\s*perform))?\s*\(|\?\.\(|this\.args\.\w+\?\.\(/.test(all) && !STRONG_HANDLER.test(all.replace(/this\.args\.\w+/g, ''))) return { delegated: true };
  return {};
}

/** this.x props that a non-destructive handler used in the template sets truthy (an "armed" confirmation state). */
function armedProps(ctx) {
  if (ctx.armed) return ctx.armed;
  ctx.armed = new Set();
  for (const e of ctx.all) {
    for (const ref of handlers(e).map(handlerRef).filter(Boolean)) {
      const body = ref.startsWith('this.') && !ref.startsWith('this.args.') ? methodBody(ctx.script, ref.split('.').pop()) : null;
      if (!body || DESTRUCTIVE_CALL.test(body)) continue;
      for (const m of body.matchAll(TRUTHY_ASSIGN)) ctx.armed.add(`this.${m[1]}`);
    }
  }
  return ctx.armed;
}

/** Inside a dialog, or the truthy branch of an {{#if}}/{{#unless}}/{{else if}} on a confirming state. */
function inConfirmationContext(el) {
  const armed = armedProps(el.ctx);
  const confirming = (c) => {
    const p = parseCondition(c);
    return p.positive && p.tokens.some((t) => confirmingToken(t) || armed.has(t));
  };
  if (el.conditions?.some(confirming)) return true;
  for (let p = el.parent; p; p = p.parent) if (isDialogEl(p)) return true;
  return false;
}

/** Type-to-confirm: a field asking the user to type something "to confirm", gating a disabled-until-valid button. */
function typeToConfirm(el) {
  const gated = el.value('disabled') === UNKNOWN || el.args().some((a) => /^@(is)?disabled$/i.test(a.name) && a.path);
  if (!gated) return false;
  const anc = el.ancestors();
  const scope = anc.find(isFormLike) ?? anc.find(isDialogEl) ?? anc[anc.length - 1];
  const els = scope ? el.ctx.all.filter((e) => e === scope || e.ancestors().includes(scope)) : el.ctx.all;
  const hasInput = els.some((e) => ['input', 'textarea'].includes(e.lowerTag) || (e.kind === 'component' && /Input|TextField/.test(e.tag)));
  if (!hasInput) return false;
  const text = els
    .flatMap((e) => [...e.content.filter((c) => c.type === 'text').map((c) => c.text), e.value('placeholder'), e.value('aria-label'), ...e.args().filter((a) => a.value).map((a) => a.value)])
    .filter((t) => typeof t === 'string')
    .join(' ')
    .replace(/\s+/g, ' ');
  return TYPE_TO_CONFIRM.test(text);
}

export const destructiveActionConfirmation = {
  id: 'destructive-action-confirmation',
  description: 'Destructive actions (delete, purge, permanently dismiss, …) must ask the user to confirm (modal or inline confirmation, or offer undo).',
  wcag: ['3.3.4', '3.3.6'],
  appliesToComponents: true,
  check(el, report) {
    if (el.lowerTag === 'a' && el.has('href')) return;
    if (isFormLike(el)) return; // reported on its submit button
    if (/^(LinkTo|link-to)$/i.test(el.tag)) return;
    // Choosing an option (radio/checkbox/toggle) is a setting, not the destructive action itself.
    if (['radio', 'checkbox'].includes(el.value('type')) || (el.kind === 'component' && /(Radio|Checkbox|Toggle)/.test(el.tag))) return;

    let exprs = handlers(el);
    // Submit button inside <form {{on "submit" …}}> / <Layout::FlexForm …>: the form handler does the work.
    if (!exprs.length && isSubmitButton(el)) {
      const form = el.ancestors().find(isFormLike);
      if (form) exprs = handlers(form);
    }
    if (!exprs.length) return;

    const dismissOnly = el.kind === 'component' && el.args().some((a) => a.name.toLowerCase() === '@ondismiss') && !el.args().some((a) => a.name.toLowerCase() === '@onclick') && !el.modifiers.length;
    const text = dismissOnly ? '' : staticText(el);
    const refs = exprs.map(handlerRef).filter(Boolean);
    const names = refs.map((r) => r.split('.').pop()).filter((n) => !isSettingHandler(n)).join(' ');
    const critical = el.args().some((a) => a.name === '@color' && a.value === 'critical');
    const strong = STRONG_TEXT.test(text) || STRONG_HANDLER.test(names);
    const weak = !strong && (WEAK_TEXT.test(text) || WEAK_HANDLER.test(names) || critical);
    if (!strong && !weak) return;
    // The label mentions destruction but the handler only opens/toggles UI (e.g. "Deactivated on destroy" → T.openFlyout).
    const textOnly = !STRONG_HANDLER.test(names) && !WEAK_HANDLER.test(names);
    // Only the handler name is (weakly) destructive and the visible label says otherwise: "Show less" → this.reset.
    if (weak && !critical && text && !WEAK_TEXT.test(text) && !STRONG_HANDLER.test(names)) return;
    if (textOnly && refs.length && refs.every((r) => /^(open|show|toggle|expand|collapse|close|navigate|goTo|transitionTo|select|view|edit)/i.test(r.split('.').pop()))) return;

    if (exprs.some((e) => /\bconfirm\s*\(/.test(e))) return;
    if (inConfirmationContext(el)) return;
    if (typeToConfirm(el)) return;

    const results = refs.map((r) => analyzeHandler(r, el.ctx, refs));
    if (results.some((r) => r.confirmed)) return;

    const what = dismissOnly ? `"dismiss" on <${el.tag}> (${refs.join(', ')})` : text ? `"${text.length > 40 ? text.slice(0, 37) + '…' : text}"` : `<${el.tag}>`;
    const help =
      'Ask the user to confirm before the action is carried out. Any of these is fine: ' +
      'a confirmation modal (<HdsModal>/<dialog> or role="alertdialog") naming the item and the consequence; ' +
      'an inline confirmation ({{#if this.isConfirming}}"Are you sure?" with Confirm/Cancel buttons{{else}}…{{/if}}, moving focus to the confirm step); ' +
      'window.confirm(); or make it reversible with an Undo. Put confirmation buttons inside the dialog or the confirming branch so they are recognised.';
    const fix = () => confirmDestructive(el, { handler: refs[0]?.startsWith('this.') || refs[0]?.startsWith('@') ? refs[0] : undefined, label: text });
    const references = ['https://www.w3.org/WAI/WCAG22/Understanding/error-prevention-legal-financial-data.html', 'https://www.w3.org/WAI/ARIA/apg/patterns/alertdialog/', 'https://helios.hashicorp.design/components/modal'];

    // Ignore companion UI handlers ({{on "click" dd.close}}) when deciding whether the work is delegated.
    const destructiveRefs = results.filter((r, i) => r.delegated || !/^(close|hide|dismiss|toggle)$/i.test(refs[i].split('.').pop()));
    if (destructiveRefs.length && destructiveRefs.every((r) => r.delegated)) {
      report({ severity: 'info', message: `Destructive action ${what} calls a handler passed in by the caller; make sure the caller asks for confirmation.`, help, references, fix });
      return;
    }
    if (destructiveRefs.length && destructiveRefs.every((r) => r.delegated || r.yielded)) {
      report({ severity: 'info', message: `Destructive action ${what} calls a handler yielded by an enclosing component; make sure that component asks for confirmation.`, help, references, fix });
      return;
    }
    // Removing a row/field while editing a form is not committed until the form is submitted.
    const isSubmit = el.lowerTag === 'button' && ['submit', null].includes(el.value('type')) || el.value('type') === 'submit';
    const editingForm = !isSubmit && el.ancestors().some((a) => a.lowerTag === 'form' || /(^|::|\.|Hds)Form$/.test(a.tag) || /^(FORM|F)$/.test(a.tag.split('.')[0]));
    report({
      severity: strong && !editingForm ? 'warning' : 'info',
      message: `Destructive action ${what} runs without a confirmation step.`,
      help,
      references,
      fix,
    });
  },
};
