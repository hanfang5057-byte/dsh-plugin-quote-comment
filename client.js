/**
 * Quote-with-comment: takes over the shipped "quote text" gesture and asks for a
 * comment before inserting, as one atomic block.
 *
 * The draft model only binds text to a quote as a single unit by putting that text
 * inside the quote node itself: a quote followed by ordinary draft text always
 * serializes as two paragraphs. So the comment goes into the same quote text,
 * separated by one blank line, and the whole thing enters the composer as one
 * quote chip. Sent, it reads:
 *
 *     > quoted lines
 *     >
 *     > the comment
 *
 * Shadowing is a priority decision: the shipped cell sits at priority 0, and the
 * lowest priority renders, so this cell registers at -1. Registering the same key
 * at the same priority throws instead of replacing.
 */
window.__ModuleLoader__.load({
  id: '@local/quote-comment',
  factory(require) {
    const React = require('react')
    const h = React.createElement
    const { useCallback, useEffect, useRef, useState } = React

    /** Client locale namespace owned by this plugin. */
    const NS = 'quoteComment'

    const zh = {
      'quote.add': '引用文本',
      'block.label': '【评论】',
      'chip.label': '引用 · {lines} 行',
      'chip.labelOne': '引用 · {lines} 行',
      'dialog.title': '引用并评论',
      'dialog.quoteLabel': '引用的内容',
      'dialog.commentLabel': '评论',
      'dialog.placeholder': '写下你的评论，留空则只插入引用',
      'dialog.hint': '引用与评论作为一个整体插入输入框',
      'dialog.blocked': '输入框暂时不可用（可能正在发送消息），评论已保留',
      'dialog.save': '保存',
      'dialog.cancel': '取消',
    }

    const en = {
      'quote.add': 'Quote text',
      'block.label': '[Comment]',
      'chip.label': 'Quote · {lines} lines',
      'chip.labelOne': 'Quote · {lines} line',
      'dialog.title': 'Quote with comment',
      'dialog.quoteLabel': 'Quoted text',
      'dialog.commentLabel': 'Comment',
      'dialog.placeholder': 'Write a comment; leave empty to quote only',
      'dialog.hint': 'The quote and the comment are inserted as one block',
      'dialog.blocked': 'The composer is busy right now; your comment was kept',
      'dialog.save': 'Save',
      'dialog.cancel': 'Cancel',
    }

    /** Styles are injected once per page and removed with the last holder. */
    const CSS = `
.qc-action {
  padding: 5px 10px;
  border: none;
  border-radius: 999px;
  corner-shape: round;
  background: var(--dsw-alias-button-floating-fill);
  --dsw-elevation-stroke-color: var(--dsw-alias-border-l3);
  box-shadow: var(--dsw-elevation-panel);
  color: var(--dsw-alias-label-primary);
  font: var(--dsw-font-xs-13);
  cursor: pointer;
}
.qc-action:focus-visible { background: var(--dsw-alias-button-floating-hover); }
@media (hover: hover) { .qc-action:hover { background: var(--dsw-alias-button-floating-hover); } }

/* The backdrop and its mask follow the shipped modal: the caption row on Windows
   stays uncovered, and the mask fades in on its own. */
.qc-backdrop {
  position: fixed;
  inset: 0;
  z-index: 1000;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: max(24px, var(--dsh-frame-overlay-top, 24px)) 24px;
}
.qc-mask {
  position: absolute;
  inset: var(--dsh-frame-chrome-top, 0px) 0 0;
  pointer-events: none;
  backdrop-filter: var(--dsw-mask-blur);
}
.qc-mask::after {
  content: '';
  position: absolute;
  inset: 0;
  background: var(--dsw-alias-bg-mask-1);
  animation: qc-fade var(--ds-transition-duration, 0.15s) var(--ds-ease-in-out, ease-in-out);
}

.qc-card {
  position: relative;
  z-index: 1;
  box-sizing: border-box;
  display: flex;
  flex-direction: column;
  gap: 16px;
  width: min(440px, 100%);
  padding: 22px 24px 24px;
  border-radius: var(--dsw-radius-panel);
  background: var(--dsw-alias-bg-layer-2);
  box-shadow: var(--dsw-elevation-prominent);
  color: var(--dsw-alias-label-primary);
  font: var(--dsw-font-s-14);
  animation: qc-fade var(--ds-transition-duration, 0.15s) var(--ds-ease-in-out, ease-in-out);
}
@keyframes qc-fade { 0% { opacity: 0 } to { opacity: 1 } }
@media (prefers-reduced-motion: reduce) {
  .qc-card, .qc-mask::after { animation: none; }
}

.qc-title {
  margin: 0;
  color: var(--dsw-alias-label-primary);
  font-size: 16px;
  line-height: 24px;
  font-weight: 500;
}

/* The one block: the quoted text sits read-only above the hairline and the comment is
   edited in place below it, so the typed text never appears twice. */
.qc-block {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 10px 12px;
  border-inline-start: 2px solid var(--dsw-alias-border-l2);
  border-radius: var(--dsw-radius-xs);
  background: var(--dsw-alias-bg-layer-3);
}
.qc-block:focus-within { border-inline-start-color: var(--dsw-alias-state-business-primary); }

.qc-quoted {
  max-height: 132px;
  overflow: auto;
  color: var(--dsw-alias-label-secondary);
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}
.qc-quoted:focus-visible {
  outline: var(--dsw-focus-ring-width, 2px) solid var(--dsw-focus-ring-color, var(--dsw-alias-state-business-primary));
  outline-offset: 2px;
}

.qc-divider {
  height: 1px;
  flex: none;
  background: var(--dsw-alias-border-l2);
}

/* The editor is the block's lower half: no second copy of the comment. */
.qc-input {
  box-sizing: border-box;
  display: block;
  width: 100%;
  min-height: 72px;
  padding: 0;
  border: none;
  outline: none;
  resize: none;
  background: transparent;
  color: var(--dsw-alias-label-primary);
  font: inherit;
}
.qc-input::placeholder { color: var(--dsw-alias-label-caption); }
@media (pointer: coarse) { .qc-input { font-size: 16px; } }

.qc-error {
  color: var(--dsw-alias-state-error-primary);
  font-size: 12px;
  line-height: 18px;
  overflow-wrap: anywhere;
}

.qc-footer {
  display: flex;
  align-items: center;
  gap: 12px;
}

.qc-hint {
  flex: 1;
  min-width: 0;
  color: var(--dsw-alias-label-caption);
  font-size: 12px;
  line-height: 18px;
  overflow-wrap: anywhere;
}

.qc-buttons { display: flex; flex: none; gap: 8px; }

/* Same box as the shipped Button at its default size. */
.qc-button {
  box-sizing: border-box;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  height: 36px;
  padding: 0 14px;
  border: none;
  border-radius: var(--dsw-radius-md);
  font-size: 14px;
  line-height: 22px;
  cursor: pointer;
}
.qc-button:focus-visible {
  outline: var(--dsw-focus-ring-width, 2px) solid var(--dsw-focus-ring-color, var(--dsw-alias-state-business-primary));
  outline-offset: 2px;
}

.qc-primary {
  background: var(--dsw-alias-button-primary-fill);
  color: var(--dsw-alias-label-primary-foreground);
}
@media (hover: hover) { .qc-primary:hover { background: var(--dsw-alias-button-primary-hover); } }

.qc-secondary {
  border: 0.5px solid var(--dsw-alias-border-l3);
  background: transparent;
  color: var(--dsw-alias-label-primary);
}
@media (hover: hover) { .qc-secondary:hover { background: var(--dsw-alias-interactive-bg-hover); } }
`

    /** Page stylesheet holders, so two mounts never fight over one <style>. */
    let styleHolders = 0

    /** Mount the plugin stylesheet; the cleanup removes it with the last holder. */
    function mountStyles() {
      const tagId = '@local/quote-comment/page.css'
      styleHolders += 1
      if (styleHolders === 1 && document.querySelector(`style[data-plugin-css="${tagId}"]`) === null) {
        const tag = document.createElement('style')
        tag.dataset.plugin = '@local/quote-comment'
        tag.dataset.pluginCss = tagId
        tag.textContent = CSS
        document.head.appendChild(tag)
      }
      return () => {
        styleHolders -= 1
        if (styleHolders > 0) return
        const tag = document.querySelector(`style[data-plugin-css="${tagId}"]`)
        tag?.remove()
      }
    }

    /** Minimal observable source: the shape the Slot inject `hooks` compartment binds. */
    function createSource(initial) {
      let value = initial
      const listeners = new Set()
      return {
        getSnapshot: () => value,
        subscribe(listener) {
          listeners.add(listener)
          return () => { listeners.delete(listener) }
        },
        set(next) {
          if (next === value) return
          value = next
          for (const listener of [...listeners]) listener()
        },
      }
    }

    /** One open request at a time, settled by the dialog with a comment or null. */
    function createBroker() {
      const pending = createSource(null)
      let resolve = null
      let previousFocus = null
      let sequence = 0
      const settle = (value) => {
        const next = resolve
        resolve = null
        previousFocus = null
        pending.set(null)
        if (next !== null) next(value)
      }
      return {
        pending,
        ask(text, prefill, blocked) {
          // Never leave an earlier request hanging: its action would wait forever.
          settle(null)
          previousFocus = typeof document === 'undefined' ? null : document.activeElement
          return new Promise(next => {
            resolve = next
            sequence += 1
            pending.set({
              text,
              key: sequence,
              prefill: prefill ?? '',
              blocked: blocked === true,
            })
          })
        },
        answer(value) { settle(value) },
        cancel() {
          const target = previousFocus
          settle(null)
          // Give the keyboard back to the field the user came from, but never steal
          // it from the composer an insertion just focused.
          if (target !== null && target.isConnected
            && (target.isContentEditable || /^(INPUT|TEXTAREA|BUTTON)$/u.test(target.tagName))) {
            target.focus({ preventScroll: true })
          }
        },
      }
    }

    /** Normalize line endings and drop surrounding blank space. */
    function clean(text) {
      return text.replace(/\r\n?/gu, '\n').trim()
    }

    /**
     * Bind the quoted text and the comment into the one atomic block the composer carries.
     * The comment lives inside the quote text because draft text outside a quote always
     * serializes as a separate paragraph; the summary only changes how the chip reads.
     *
     * The comment starts its own labelled section: a bare blank quoted line does not tell a
     * reader (or the model) where the quoted material ends, so the comment would be read as
     * one more quoted line. A standalone marker line is the cheapest reliable boundary, and
     * being a whole line it is far less likely to occur inside quoted prose than an inline
     * prefix would be.
     * @param quoted - selected transcript text.
     * @param comment - comment text, possibly empty.
     * @param t - locale seat for the chip and section labels.
     * @returns the text to insert, and the summary when a comment is present.
     */
    function buildBlock(quoted, comment, t) {
      const text = clean(quoted)
      const note = clean(comment)
      if (note === '') return { text, summary: undefined }
      const lines = text.split('\n').filter(line => line.trim() !== '').length || 1
      return {
        text: `${text}\n\n${t('block.label')}\n${note}`,
        summary: {
          label: t(lines === 1 ? 'chip.labelOne' : 'chip.label', { lines }),
          title: text,
          body: note,
        },
      }
    }

    /**
     * Replacement for the shipped quote action.
     * @param props - area-local text interaction, composer seats, locale, and the broker.
     */
    function QuoteCommentAction(props) {
      const { dismiss, readText, clearSelection, inputActions, useSession, useInput, t, ask } = props
      const enabled = useSession(s => !s.removed
        && (s.subagent === null || s.subagent.address.mode === 'continuable'))
      const phase = useInput(s => s.phase)
      useEffect(() => {
        if (!enabled) dismiss()
      }, [enabled, dismiss])
      if (!enabled) return null

      /**
       * Ask for a comment and insert the block; a refused insertion reopens the
       * dialog with the typed comment instead of dropping it.
       * @param text - quoted text.
       * @param prefill - comment to show again.
       * @param blocked - whether the previous attempt was refused by the composer.
       */
      const open = (text, prefill, blocked) => {
        ask(text, prefill, blocked).then((comment) => {
          if (comment === null) return
          const block = buildBlock(text, comment, t)
          if (inputActions.insertQuote(block.text, block.summary)) { clearSelection(); return }
          open(text, comment, true)
        })
      }

      return h('button', {
        type: 'button',
        className: 'qc-action',
        'aria-label': t('quote.add'),
        onPointerDown: (event) => { event.preventDefault() },
        onClick: () => {
          const text = readText()
          // A blank selection has nothing to quote; the composer would refuse it too.
          if (text === null || clean(text) === '') { dismiss(); return }
          // A frozen composer refuses every insertion, so keep the shipped behaviour
          // (a click that inserts nothing) instead of collecting a comment to lose.
          if (phase !== 'plain') { inputActions.insertQuote(text); dismiss(); return }
          // Hide the floating action first: the dialog owns the next step, and a
          // selection change would dismiss this surface anyway.
          dismiss()
          open(text, '', false)
        },
      }, t('quote.add'))
    }

    /**
     * Comment dialog, rendered in the frame-wide overlay layer.
     * @param props - the pending-request hook, the settle callbacks, and the translator.
     */
    function QuoteCommentDialog({ usePending, answer, cancel, t }) {
      const pending = usePending(value => value)
      const [draft, setDraft] = useState('')
      const input = useRef(null)
      const requestKey = pending === null ? null : pending.key

      useEffect(() => {
        if (pending === null) return undefined
        setDraft(pending.prefill)
        const frame = requestAnimationFrame(() => { input.current?.focus() })
        return () => { cancelAnimationFrame(frame) }
      }, [pending])

      const submit = useCallback(() => { answer(draft) }, [answer, draft])

      if (pending === null) return null

      return h('div', {
        className: 'qc-backdrop',
        onPointerDown: (event) => {
          if (event.target === event.currentTarget) cancel()
        },
      },
      h('div', { className: 'qc-mask', 'aria-hidden': 'true' }),
      h('div', {
        className: 'qc-card',
        role: 'dialog',
        'aria-modal': 'true',
        'aria-label': t('dialog.title'),
        onKeyDown: (event) => {
          if (event.key === 'Escape') { event.preventDefault(); cancel(); return }
          if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) { event.preventDefault(); submit(); return }
          // Keep the keyboard inside the dialog: the layer behind it stays visible
          // but must not take focus while this surface owns the interaction.
          if (event.key === 'Tab') {
            event.preventDefault()
            const stops = Array.from(event.currentTarget
              .querySelectorAll('textarea, button, [tabindex]:not([tabindex="-1"])'))
            const at = stops.indexOf(event.target)
            const step = event.shiftKey ? -1 : 1
            const next = stops[(at + step + stops.length) % stops.length] ?? stops[0]
            next?.focus()
          }
        },
      },
      h('h2', { className: 'qc-title' }, t('dialog.title')),
      h('div', { className: 'qc-block', role: 'group' },
        h('div', {
          className: 'qc-quoted',
          tabIndex: 0,
          'aria-label': t('dialog.quoteLabel'),
        }, clean(pending.text)),
        h('div', { className: 'qc-divider', 'aria-hidden': 'true' }),
        // The editor is the block's own lower half: what the user types appears
        // once, where it will end up, instead of echoing under the quote.
        h('textarea', {
          ref: input,
          className: 'qc-input',
          value: draft,
          rows: 3,
          placeholder: t('dialog.placeholder'),
          'aria-label': t('dialog.commentLabel'),
          onChange: (event) => { setDraft(event.target.value) },
        }),
      ),
      pending.blocked && h('div', { className: 'qc-error', role: 'status' }, t('dialog.blocked')),
      h('div', { className: 'qc-footer' },
        h('span', { className: 'qc-hint' }, t('dialog.hint')),
        h('div', { className: 'qc-buttons' },
          h('button', {
            type: 'button',
            className: 'qc-button qc-secondary',
            onClick: cancel,
          }, t('dialog.cancel')),
          h('button', {
            type: 'button',
            className: 'qc-button qc-primary',
            onClick: submit,
          }, t('dialog.save')),
        ),
      ),
      ))
    }

    /** Services this plugin needs before `apply` runs. */
    const inject = ['slots', 'locale']

    /**
     * Register the replacement action, the dialog, and their shared copy.
     * @param ctx - Client root context owning every contribution here.
     */
    function apply(ctx) {
      ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'quote-comment: dictionaries')
      ctx.effect(mountStyles, 'quote-comment: styles')
      const broker = createBroker()
      // The dialog lives in a root-scoped slot, so it takes the translator directly
      // instead of relying on a scope-specific locale seat.
      const t = ctx.locale.bind(NS)
      ctx.effect(() => () => { broker.answer(null) }, 'quote-comment: pending dialog')

      // priority -1 shadows the shipped cell at 0; the lowest priority renders.
      ctx.slots.inject('conversation.chat.text-interaction', () => ctx.slots.register({
        name: 'conversation.chat.text-interaction',
        key: 'quote',
        priority: -1,
        locale: NS,
        inject: () => ({ ask: broker.ask }),
      }, QuoteCommentAction))

      ctx.slots.inject('shell.overlay', () => ctx.slots.register({
        name: 'shell.overlay',
        id: 'quote-comment.dialog',
        order: 20,
        inject: () => ({
          hooks: { pending: broker.pending },
          answer: broker.answer,
          cancel: broker.cancel,
          t,
        }),
      }, QuoteCommentDialog))
    }

    return { name: 'quote-comment', inject, apply }
  },
})
