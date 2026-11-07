// ランキングに出す名前の入力欄。ゲームの canvas の上に <dialog> で重ねる。
// canvas の中では日本語を入力できないので、HTML の入力欄を使う。
import { type Client, MAX_NAME_LENGTH } from './client.ts';

/** first は初めて聞くとき、change はゲームから開いて名前を変えるとき */
export type NameDialogMode = 'first' | 'change';

export interface NameDialog {
  open(mode: NameDialogMode): void;
  isOpen(): boolean;
}

// 余白は 4px の倍数でそろえる。見出しと説明は近く、入力欄の上は広く、ボタンの上はいちばん広く空ける
const STYLE = `
.roommate-name-dialog {
  --rm-bg: #fffaf0; --rm-fg: #3a2a1e; --rm-muted: #7a6656; --rm-line: #e6d6bd;
  --rm-accent: #ff9852; --rm-on-accent: #3a2a1e; --rm-error: #b3261e;
  box-sizing: border-box;
  width: min(22rem, calc(100vw - 32px));
  margin: auto;
  padding: 24px;
  border: 1px solid var(--rm-line);
  border-radius: 16px;
  background: var(--rm-bg);
  color: var(--rm-fg);
  font: 15px/1.6 system-ui, sans-serif;
  word-break: auto-phrase;
  text-wrap: pretty;
}
@media (prefers-color-scheme: dark) {
  .roommate-name-dialog {
    --rm-bg: #272019; --rm-fg: #fff1dc; --rm-muted: #bca88f; --rm-line: #4a3e31;
    --rm-error: #ff9c8f;
  }
}
.roommate-name-dialog:modal { overscroll-behavior: contain; }
.roommate-name-dialog::backdrop {
  background: rgba(0, 0, 0, 0.6);
  overflow: hidden;
  overscroll-behavior: contain;
}
.roommate-name-dialog h2 { margin: 0; font-size: 18px; line-height: 1.4; }
.roommate-name-dialog .rm-lead { margin: 4px 0 0; color: var(--rm-muted); font-size: 14px; }
.roommate-name-dialog input {
  display: block;
  box-sizing: border-box;
  width: 100%;
  margin-top: 16px;
  padding: 10px 12px;
  border: 1px solid var(--rm-muted);
  border-radius: 8px;
  background: transparent;
  color: inherit;
  font: inherit;
  font-size: 16px;
  line-height: 1.4;
}
.roommate-name-dialog input:focus-visible {
  outline: 2px solid var(--rm-fg);
  outline-offset: -1px;
}
.roommate-name-dialog input[aria-invalid="true"] {
  border-color: var(--rm-error);
  outline-color: var(--rm-error);
}
.roommate-name-dialog .rm-meta {
  display: flex;
  align-items: baseline;
  gap: 12px;
  margin-top: 8px;
  color: var(--rm-muted);
  font-size: 13px;
  line-height: 1.5;
}
.roommate-name-dialog .rm-preview,
.roommate-name-dialog .rm-error { flex: 1; min-width: 0; margin: 0; overflow-wrap: anywhere; }
.roommate-name-dialog .rm-preview b { color: var(--rm-fg); font-weight: 600; }
.roommate-name-dialog .rm-error { color: var(--rm-error); }
.roommate-name-dialog .rm-count { flex: none; font-variant-numeric: tabular-nums; }
.roommate-name-dialog .rm-count[data-over] { color: var(--rm-error); font-weight: 600; }
.roommate-name-dialog .rm-actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  margin-top: 24px;
}
.roommate-name-dialog button {
  min-height: 40px;
  padding: 0 20px;
  border: 1px solid var(--rm-line);
  border-radius: 999px;
  background: transparent;
  color: inherit;
  font: inherit;
  cursor: pointer;
}
.roommate-name-dialog button[type="submit"] {
  border-color: var(--rm-accent);
  background: var(--rm-accent);
  color: var(--rm-on-accent);
  font-weight: 700;
}
.roommate-name-dialog button:disabled { opacity: 0.6; cursor: default; }
.roommate-name-dialog button:focus-visible { outline: 2px solid var(--rm-fg); outline-offset: 2px; }
.roommate-name-dialog [hidden] { display: none; }
`;

const MESSAGES = {
  tooLong: `${MAX_NAME_LENGTH} 文字までにしてください`,
  invalid: '# と見えない文字は使えません',
  failed: '保存できませんでした。もう一度試してください',
} as const;

/** API と同じく、前後の空白を落とし、続く空白を 1 つにまとめる */
function normalize(value: string): string {
  return value.normalize('NFC').trim().replace(/\s+/gu, ' ');
}

export function createNameDialog(client: Client, doc: Document = document): NameDialog {
  let dialog: HTMLDialogElement | undefined;
  let saving = false;

  function build(): HTMLDialogElement {
    const style = doc.createElement('style');
    style.textContent = STYLE;
    doc.head.append(style);

    const el = doc.createElement('dialog');
    el.className = 'roommate-name-dialog';
    el.setAttribute('aria-labelledby', 'roommate-name-title');
    el.innerHTML = `
      <form method="dialog" novalidate>
        <h2 id="roommate-name-title">ランキングに出す名前</h2>
        <p class="rm-lead" id="roommate-name-lead">同じコースの人と、この名前で競います。</p>
        <input name="name" autocomplete="nickname" enterkeyhint="done" spellcheck="false"
          aria-labelledby="roommate-name-title"
          aria-describedby="roommate-name-lead roommate-name-preview roommate-name-error" />
        <div class="rm-meta">
          <p class="rm-preview" id="roommate-name-preview"></p>
          <p class="rm-error" id="roommate-name-error" role="alert" hidden></p>
          <span class="rm-count" aria-hidden="true"></span>
        </div>
        <div class="rm-actions">
          <button type="button" data-action="cancel"></button>
          <button type="submit"></button>
        </div>
      </form>`;
    doc.body.append(el);

    const input = el.querySelector('input')!;
    const form = el.querySelector('form')!;

    // macroquad のローダーは window で paste を止めるので、入力欄の貼り付けをそこへ届かせない
    input.addEventListener('paste', (event) => event.stopPropagation());
    input.addEventListener('input', () => refresh(el, client));

    el.querySelector('[data-action="cancel"]')!.addEventListener('click', () => el.close());
    // 保存している間は閉じない。閉じると結果を伝えられない
    el.addEventListener('cancel', (event) => {
      if (saving) event.preventDefault();
    });
    el.addEventListener('close', () => {
      // 自動で開いたときは戻す先のボタンが無い。閉じた後のキー入力がゲームに届くよう、canvas へ戻す
      doc.querySelector<HTMLCanvasElement>('#glcanvas')?.focus();
    });

    // Enter は form の送信に任せる。IME の変換を確定する Enter では、ブラウザが送信しない
    form.addEventListener('submit', (event) => {
      event.preventDefault();
      if (saving) return;
      const name = normalize(input.value);
      const problem = problemOf(name);
      if (problem) {
        showError(el, MESSAGES[problem]);
        input.focus();
        return;
      }
      // 初めて聞いたときに空のまま決めたら、「あとで」と同じにする
      if (name === '' && el.dataset.mode === 'first') {
        el.close();
        return;
      }
      setSaving(el, true);
      void client.setName(name).then((result) => {
        setSaving(el, false);
        if (result === 'saved') {
          el.close();
        } else {
          showError(el, MESSAGES[result]);
          input.focus();
        }
      });
    });
    return el;
  }

  function setSaving(el: HTMLDialogElement, value: boolean) {
    saving = value;
    const submit = el.querySelector<HTMLButtonElement>('button[type="submit"]')!;
    submit.disabled = value;
    submit.textContent = value ? '保存中…' : '決める';
  }

  return {
    open(mode) {
      if (client.deleteState() === 'done') return;
      dialog ??= build();
      if (dialog.open) return;
      const el = dialog;
      el.dataset.mode = mode;
      // 説明は初めて出すときだけ。名前を変えに来た人には要らない
      el.querySelector<HTMLElement>('.rm-lead')!.hidden = mode !== 'first';
      el.querySelector('[data-action="cancel"]')!.textContent =
        mode === 'first' ? 'あとで' : 'やめる';
      setSaving(el, false);
      const input = el.querySelector('input')!;
      input.value = client.name() ?? '';
      refresh(el, client);
      // 今の名前をまだ読んでいなければ読み、打ち始めていなければ入れる
      if (client.name() === undefined) {
        void client.loadName().then((name) => {
          if (name && input.value === '') {
            input.value = name;
            refresh(el, client);
          }
        });
      }
      // 一度出したら、閉じても次からは自動では出さない
      if (mode === 'first') client.markNameAsked();
      el.showModal();
    },
    isOpen() {
      return dialog?.open ?? false;
    },
  };
}

function problemOf(name: string): 'tooLong' | 'invalid' | undefined {
  if ([...name].length > MAX_NAME_LENGTH) return 'tooLong';
  if (/[\p{Cc}\p{Cf}\p{Co}\p{Cs}\p{Zl}\p{Zp}#＃]/u.test(name)) return 'invalid';
  return undefined;
}

/** 打つたびに、ランキングでの見え方と文字数を出し直す。使えない文字はその場で知らせる */
function refresh(el: HTMLDialogElement, client: Client) {
  const name = normalize(el.querySelector('input')!.value);
  const length = [...name].length;
  const count = el.querySelector<HTMLElement>('.rm-count')!;
  count.textContent = `${length}/${MAX_NAME_LENGTH}`;
  count.toggleAttribute('data-over', length > MAX_NAME_LENGTH);

  const problem = problemOf(name);
  if (problem) {
    showError(el, MESSAGES[problem]);
    return;
  }
  showError(el, '');
  const preview = el.querySelector<HTMLElement>('.rm-preview')!;
  const id = client.playerId();
  // ID がまだ無ければ、付く 4 文字を見せられないので出さない
  if (!id) {
    preview.replaceChildren();
    return;
  }
  const shown = el.ownerDocument.createElement('b');
  shown.textContent = `${name || '名無し'}#${id.slice(0, 4)}`;
  preview.replaceChildren('ランキングでの表示: ', shown);
}

/** エラーを出している間は、ランキングでの見え方の代わりに同じ場所へ出す。空なら戻す */
function showError(el: HTMLDialogElement, text: string) {
  const error = el.querySelector<HTMLElement>('.rm-error')!;
  error.textContent = text;
  error.hidden = text === '';
  el.querySelector<HTMLElement>('.rm-preview')!.hidden = text !== '';
  el.querySelector('input')!.setAttribute('aria-invalid', String(text !== ''));
}
