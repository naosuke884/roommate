// ランキングに出す名前の入力欄。ゲームの canvas の上に <dialog> で重ねる。
// canvas の中では日本語を入力できないので、HTML の入力欄を使う。
import { type Client, MAX_NAME_LENGTH } from './client.ts';

/** first は初めて聞くとき、change はゲームから開いて名前を変えるとき */
export type NameDialogMode = 'first' | 'change';

export interface NameDialog {
  open(mode: NameDialogMode): void;
  isOpen(): boolean;
}

const STYLE = `
.roommate-name-dialog {
  --rm-bg: #fffaf0; --rm-fg: #3a2a1e; --rm-muted: #7a6656; --rm-line: #efe3cf;
  --rm-accent: #ff9852; --rm-error: #b3261e;
  box-sizing: border-box;
  width: min(24rem, calc(100vw - 32px));
  padding: 20px;
  border: 1px solid var(--rm-line);
  border-radius: 14px;
  background: var(--rm-bg);
  color: var(--rm-fg);
  font: 15px/1.6 system-ui, sans-serif;
}
@media (prefers-color-scheme: dark) {
  .roommate-name-dialog {
    --rm-bg: #272019; --rm-fg: #fff1dc; --rm-muted: #bca88f; --rm-line: #3d3328;
    --rm-error: #ff9c8f;
  }
}
.roommate-name-dialog::backdrop { background: rgba(0, 0, 0, 0.6); }
.roommate-name-dialog h2 { margin: 0 0 8px; font-size: 18px; }
.roommate-name-dialog p { margin: 0 0 12px; color: var(--rm-muted); font-size: 13px; }
.roommate-name-dialog input {
  box-sizing: border-box;
  width: 100%;
  padding: 8px 10px;
  border: 1px solid var(--rm-muted);
  border-radius: 8px;
  background: transparent;
  color: inherit;
  font: inherit;
  font-size: 16px;
}
.roommate-name-dialog .rm-status { min-height: 1.6em; margin: 6px 0 0; font-size: 13px; }
.roommate-name-dialog .rm-status[data-error] { color: var(--rm-error); }
.roommate-name-dialog .rm-actions {
  display: flex; justify-content: flex-end; gap: 12px; margin-top: 12px;
}
.roommate-name-dialog button {
  padding: 6px 18px;
  border: 1px solid var(--rm-muted);
  border-radius: 999px;
  background: transparent;
  color: inherit;
  font: inherit;
  cursor: pointer;
}
.roommate-name-dialog button[type="submit"] {
  border-color: var(--rm-accent);
  background: var(--rm-accent);
  color: #3a2a1e;
  font-weight: 700;
}
.roommate-name-dialog button:disabled { opacity: 0.6; cursor: default; }
.roommate-name-dialog :focus-visible { outline: 2px solid currentColor; outline-offset: 2px; }
`;

const USE_HINT = `${MAX_NAME_LENGTH} 文字まで。# と見えない文字は使えません`;

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
      <form method="dialog">
        <h2 id="roommate-name-title">ランキングに出す名前</h2>
        <p id="roommate-name-note"></p>
        <input name="name" autocomplete="nickname" enterkeyhint="done"
          aria-labelledby="roommate-name-title" aria-describedby="roommate-name-note roommate-name-status" />
        <p class="rm-status" id="roommate-name-status" aria-live="polite"></p>
        <div class="rm-actions">
          <button type="button" data-action="cancel"></button>
          <button type="submit">決める</button>
        </div>
      </form>`;
    doc.body.append(el);

    const input = el.querySelector('input')!;
    const form = el.querySelector('form')!;
    const submit = el.querySelector<HTMLButtonElement>('button[type="submit"]')!;

    // macroquad のローダーは window で paste を止めるので、入力欄の貼り付けをそこへ届かせない
    input.addEventListener('paste', (event) => event.stopPropagation());
    input.addEventListener('input', () => showStatus(el, ''));

    el.querySelector('[data-action="cancel"]')!.addEventListener('click', () => el.close());
    // 保存している間は閉じない。閉じると結果を伝えられない
    el.addEventListener('cancel', (event) => {
      if (saving) event.preventDefault();
    });
    el.addEventListener('close', () => {
      // 閉じた後のキー入力がゲームに届くよう、フォーカスを canvas へ戻す
      doc.querySelector<HTMLCanvasElement>('#glcanvas')?.focus();
    });

    form.addEventListener('submit', (event) => {
      event.preventDefault();
      if (saving) return;
      const name = input.value.trim();
      if ([...name].length > MAX_NAME_LENGTH) {
        showStatus(el, `${MAX_NAME_LENGTH} 文字までにしてください`, true);
        return;
      }
      // 初めて聞いたときに空のまま決めたら、「あとで」と同じにする
      if (name === '' && el.dataset.mode === 'first') {
        el.close();
        return;
      }
      saving = true;
      submit.disabled = true;
      showStatus(el, '保存しています');
      void client.setName(name).then((result) => {
        saving = false;
        submit.disabled = false;
        if (result === 'saved') {
          el.close();
        } else if (result === 'invalid') {
          showStatus(el, `この名前は使えません。${USE_HINT}`, true);
        } else {
          showStatus(
            el,
            '保存できませんでした。通信できるか確かめて、もう一度試してください',
            true,
          );
        }
      });
    });
    return el;
  }

  return {
    open(mode) {
      if (client.deleteState() === 'done') return;
      dialog ??= build();
      if (dialog.open) return;
      dialog.dataset.mode = mode;
      dialog.querySelector('#roommate-name-note')!.textContent =
        mode === 'first'
          ? `名前のうしろに ID の先頭 4 文字が付きます。付けなければ「名無し」と出ます。${USE_HINT}。`
          : `名前のうしろに ID の先頭 4 文字が付きます。空にすると「名無し」に戻ります。${USE_HINT}。`;
      dialog.querySelector('[data-action="cancel"]')!.textContent =
        mode === 'first' ? 'あとで' : 'やめる';
      const input = dialog.querySelector('input')!;
      input.value = client.name() ?? '';
      showStatus(dialog, '');
      // 今の名前をまだ読んでいなければ読み、打ち始めていなければ入れる
      if (client.name() === undefined) {
        void client.loadName().then((name) => {
          if (name && input.value === '') input.value = name;
        });
      }
      // 一度出したら、閉じても次からは自動では出さない
      if (mode === 'first') client.markNameAsked();
      dialog.showModal();
    },
    isOpen() {
      return dialog?.open ?? false;
    },
  };
}

function showStatus(dialog: HTMLDialogElement, text: string, error = false) {
  const status = dialog.querySelector<HTMLElement>('.rm-status')!;
  status.textContent = text;
  status.toggleAttribute('data-error', error);
}
