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
  id: 'dsh-plugin-quote-comment',
  factory(require) {
    const React = require('react')
    const h = React.createElement
    const { useCallback, useEffect, useRef, useState } = React

    /** Client locale namespace owned by this plugin. */
    const NS = 'quoteComment'

    const zh = {
      'quote.add': '引用文本',
      'block.label': '【评论】',
      'block.source': '【来源】{where}',
      'chip.label': '引用 · {lines} 行',
      'chip.labelOne': '引用 · {lines} 行',
      'dialog.title': '引用并评论',
      'dialog.titleFile': '引用文件内容并评论',
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
      'block.source': '[Source] {where}',
      'chip.label': 'Quote · {lines} lines',
      'chip.labelOne': 'Quote · {lines} line',
      'dialog.title': 'Quote with comment',
      'dialog.titleFile': 'Quote file content with comment',
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

/* The preview action floats over the whole frame: a preview pane clips its own
   overflow, so the root overlay, not the preview header, owns this button. */
.qc-preview-action {
  position: fixed;
  /* Below the dialog layer, so an open dialog always owns the frame. */
  z-index: 999;
  visibility: hidden;
  pointer-events: auto;
}

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

/* Provenance of a preview selection: the file and the selected line span. */
.qc-source {
  overflow: hidden;
  color: var(--dsw-alias-label-caption);
  font: var(--dsw-font-xs-13);
  text-overflow: ellipsis;
  white-space: nowrap;
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
      const tagId = 'dsh-plugin-quote-comment/page.css'
      styleHolders += 1
      if (styleHolders === 1 && document.querySelector(`style[data-plugin-css="${tagId}"]`) === null) {
        const tag = document.createElement('style')
        tag.dataset.plugin = 'dsh-plugin-quote-comment'
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
        ask(text, prefill, blocked, source) {
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
              source,
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

    /** The element a node belongs to, so `closest` can answer for text nodes too. */
    function elementOf(node) {
      if (node === null || node === undefined) return null
      return node.nodeType === Node.ELEMENT_NODE ? node : node.parentElement ?? null
    }

    /** Prefix every file tab address carries: `dsh-resource://file/session/<session>/<path>`. */
    const FILE_ADDRESS_PREFIX = 'dsh-resource://file/session/'

    /** Split one file tab address into its Session and its decoded workspace path. */
    function splitFileAddress(address) {
      if (typeof address !== 'string' || !address.startsWith(FILE_ADDRESS_PREFIX)) return null
      const rest = address.slice(FILE_ADDRESS_PREFIX.length)
      const cut = rest.indexOf('/')
      if (cut <= 0) return null
      const decode = (part) => {
        try { return decodeURIComponent(part) } catch { return part }
      }
      return {
        sessionId: decode(rest.slice(0, cut)),
        path: rest.slice(cut + 1).split('/').map(decode).join('/'),
      }
    }

    /** The right Sidebar Session a preview root belongs to. */
    function sessionOfPreview(root) {
      const shown = root.closest('[data-sidebar-right-session]')?.getAttribute('data-sidebar-right-session')
      if (shown !== null && shown !== undefined && shown !== '') return shown
      return splitFileAddress(root.getAttribute('data-textpreview-url'))?.sessionId ?? null
    }

    /** The workspace path a preview root shows, falling back to the header's own text. */
    function pathOfPreview(root) {
      const parsed = splitFileAddress(root.getAttribute('data-textpreview-url'))
      if (parsed !== null && parsed.path !== '') return parsed.path
      return root.querySelector('[data-textpreview-path]')?.textContent?.trim() ?? ''
    }

    /** Count the line breaks a text holds. */
    function countBreaks(text) {
      let count = 0
      for (let index = 0; index < text.length; index += 1) {
        if (text.charCodeAt(index) === 10) count += 1
      }
      return count
    }

    /** The 1-based source line an offset sits on, and whether the measured text ends on a break. */
    function codeLineOf(scope, node, offset) {
      const range = document.createRange()
      range.setStart(scope, 0)
      range.setEnd(node, offset)
      const text = range.toString()
      return { line: countBreaks(text) + 1, endsWithBreak: text.endsWith('\n') }
    }

    /**
     * The source line span a preview selection covers. Plain text carries its own
     * line elements; code counts the breaks the highlighting markup holds between
     * lines (the gutter numbers are drawn with `::before`, never in the text).
     * Rendered formats (Markdown, PDF) report lines of layout, not source, so they
     * get no span.
     */
    function linesOfPreview(root, range) {
      const renderer = root.getAttribute('data-document-preview') ?? ''
      if (renderer.endsWith('/text')) {
        const first = elementOf(range.startContainer)?.closest('[data-textpreview-line]')
        const last = elementOf(range.endContainer)?.closest('[data-textpreview-line]')
        if (first === null || first === undefined || last === null || last === undefined) return undefined
        const start = Number(first.getAttribute('data-textpreview-line'))
        let end = Number(last.getAttribute('data-textpreview-line'))
        if (!(start >= 1) || !(end >= 1)) return undefined
        // A trailing line break means the selection stopped at the next line's start.
        if (range.toString().endsWith('\n')) end -= 1
        return { start, end: Math.max(start, end) }
      }
      if (renderer.endsWith('/code')) {
        const scope = elementOf(range.startContainer)?.closest('pre')
        if (scope === null || scope === undefined) return undefined
        const start = codeLineOf(scope, range.startContainer, range.startOffset)
        const last = codeLineOf(scope, range.endContainer, range.endOffset)
        return { start: start.line, end: Math.max(start.line, last.endsWithBreak ? last.line - 1 : last.line) }
      }
      return undefined
    }

    /** The `path:lines` spelling shared by the sent block, the chip, and the dialog. */
    function whereOf(source) {
      const lines = source.lines
      if (lines === undefined) return source.path
      const span = lines.start === lines.end ? `${lines.start}` : `${lines.start}-${lines.end}`
      return `${source.path}:${span}`
    }

    /** Provenance of a preview selection, or undefined when its path is unknown. */
    function sourceOfPreview(root, range) {
      const path = pathOfPreview(root)
      if (path === '') return undefined
      const lines = linesOfPreview(root, range)
      return lines === undefined ? { path } : { path, lines }
    }

    /** The preview root's visible area, intersected with the viewport. */
    function previewBounds(root) {
      const rect = root.getBoundingClientRect()
      return {
        left: Math.max(0, rect.left),
        top: Math.max(0, rect.top),
        right: Math.min(window.innerWidth, rect.right),
        bottom: Math.min(window.innerHeight, rect.bottom),
      }
    }

    /** The first selected line rectangle inside the visible area. */
    function anchorRectOf(range, bounds) {
      for (const rect of range.getClientRects()) {
        if (rect.width <= 0 || rect.height <= 0) continue
        if (rect.bottom < bounds.top || rect.top > bounds.bottom) continue
        if (rect.right < bounds.left || rect.left > bounds.right) continue
        return rect
      }
      return null
    }

    /** Keep a measured coordinate inside a range, tolerating an over-tight bound. */
    function clamp(value, min, max) {
      return Math.min(Math.max(value, min), Math.max(min, max))
    }

    /**
     * Composer seats per Session, keyed by Session id. A preview quote needs the
     * Session's `inputActions`, and only a Session-scoped slot receives them, so
     * one invisible entry per mounted composer publishes them here.
     */
    const previewBridges = new Map()

    /** Bridge registry version, so the floating action re-evaluates on mounts. */
    const bridgeVersion = createSource(0)

    function bumpBridges() {
      bridgeVersion.set(bridgeVersion.getSnapshot() + 1)
    }

    /** Publish one composer seat; the returned release is balanced per hold. */
    function holdBridge(sessionId, inputActions) {
      let entry = previewBridges.get(sessionId)
      if (entry === undefined) {
        entry = { inputActions, phase: 'plain', writable: true, holders: 1 }
        previewBridges.set(sessionId, entry)
      } else {
        entry.holders += 1
        entry.inputActions = inputActions
      }
      bumpBridges()
      return () => {
        const current = previewBridges.get(sessionId)
        if (current === undefined) return
        current.holders -= 1
        if (current.holders <= 0) previewBridges.delete(sessionId)
        bumpBridges()
      }
    }

    /** Update one seat's live admission; unchanged values never churn the registry. */
    function syncBridge(sessionId, phase, writable) {
      const entry = previewBridges.get(sessionId)
      if (entry === undefined || (entry.phase === phase && entry.writable === writable)) return
      entry.phase = phase
      entry.writable = writable
      bumpBridges()
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
     * @param source - file provenance, when the selection came from a file preview.
     * @returns the text to insert, and the summary when a comment is present.
     */
    function buildBlock(quoted, comment, t, source) {
      const text = clean(quoted)
      const note = clean(comment)
      // Provenance rides inside the quote: ordinary draft text outside the quote
      // node always serializes as its own paragraph, so a source line placed there
      // would split the block. It reads as the first quoted line and is never
      // counted as quoted content for the chip label.
      const head = source === undefined ? '' : `${t('block.source', { where: whereOf(source) })}\n`
      if (note === '') return { text: `${head}${text}`, summary: undefined }
      const lines = text.split('\n').filter(line => line.trim() !== '').length || 1
      return {
        text: `${head}${text}\n\n${t('block.label')}\n${note}`,
        summary: {
          label: t(lines === 1 ? 'chip.labelOne' : 'chip.label', { lines }),
          title: `${head}${text}`,
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
     * Bridge entry rendered by every mounted composer. It publishes the Session's
     * input seat and live admission for the floating preview action and renders
     * nothing, so the composer surface itself is untouched.
     * @param props - the Session's standard seats and the Session identity.
     */
    function PreviewComposerBridge({ sessionId, useSession, useInput, inputActions }) {
      const writable = useSession(s => !s.removed
        && (s.subagent === null || s.subagent.address.mode === 'continuable'))
      const phase = useInput(s => s.phase)
      useEffect(() => holdBridge(sessionId, inputActions), [sessionId, inputActions])
      useEffect(() => { syncBridge(sessionId, phase, writable) }, [sessionId, phase, writable])
      return null
    }

    /**
     * Floating quote action for a selection inside a file preview. The preview
     * pane clips its own overflow, so this button lives in the frame overlay and
     * positions itself over the selection in viewport coordinates. Only previews
     * whose text is ordinary DOM report a selection this can read; the sandboxed
     * HTML frame and the spreadsheet canvas never do.
     * @param props - the pending-request ask, copy, and the bridge version hook.
     */
    function PreviewQuoteAction({ t, ask, useBridges, usePending }) {
      const version = useBridges(value => value)
      const pending = usePending(value => value)
      const button = useRef(null)
      const target = useRef(null)

      const hide = useCallback(() => {
        target.current = null
        if (button.current !== null) button.current.style.visibility = 'hidden'
      }, [])

      // The preview has no text-interaction seat of its own, so the selection is
      // read here: only a range inside a preview root with a live composer seat
      // earns the action. While the dialog owns the next step nothing floats.
      useEffect(() => {
        const element = button.current
        if (element === null) return undefined
        let frame = 0
        const evaluate = () => {
          if (pending !== null) { hide(); return }
          const selection = document.getSelection()
          if (selection === null || selection.rangeCount === 0 || selection.isCollapsed) { hide(); return }
          const range = selection.getRangeAt(0)
          const text = selection.toString()
          if (text.trim() === '') { hide(); return }
          const root = elementOf(range.commonAncestorContainer)?.closest('[data-document-preview]')
          if (root === null || root === undefined) { hide(); return }
          const sessionId = sessionOfPreview(root)
          const seat = sessionId === null ? undefined : previewBridges.get(sessionId)
          if (seat === undefined || !seat.writable || seat.phase !== 'plain') { hide(); return }
          const bounds = previewBounds(root)
          if (bounds.right <= bounds.left || bounds.bottom <= bounds.top) { hide(); return }
          const anchor = anchorRectOf(range, bounds)
          if (anchor === null) { hide(); return }
          const source = sourceOfPreview(root, range)
          const size = element.getBoundingClientRect()
          const left = clamp(anchor.left + anchor.width / 2 - size.width / 2, bounds.left, bounds.right - size.width)
          let top = anchor.top - 8 - size.height
          if (top < bounds.top) top = anchor.bottom + 8
          top = clamp(top, bounds.top, bounds.bottom - size.height)
          target.current = { text, source, sessionId }
          element.style.left = `${Math.round(left)}px`
          element.style.top = `${Math.round(top)}px`
          element.style.visibility = 'visible'
        }
        const schedule = () => {
          if (frame !== 0) return
          frame = requestAnimationFrame(() => { frame = 0; evaluate() })
        }
        const outside = (event) => {
          if (event.composedPath().includes(element)) return
          hide()
        }
        evaluate()
        document.addEventListener('selectionchange', schedule)
        document.addEventListener('pointerdown', outside, true)
        window.addEventListener('scroll', schedule, true)
        window.addEventListener('resize', schedule)
        return () => {
          if (frame !== 0) cancelAnimationFrame(frame)
          document.removeEventListener('selectionchange', schedule)
          document.removeEventListener('pointerdown', outside, true)
          window.removeEventListener('scroll', schedule, true)
          window.removeEventListener('resize', schedule)
        }
      }, [hide, version, pending])

      /**
       * Ask for a comment and insert the block; a refused insertion reopens the
       * dialog with the typed comment instead of dropping it.
       * @param chosen - the captured selection, its provenance, and its Session.
       * @param prefill - comment to show again.
       * @param blocked - whether the previous attempt was refused by the composer.
       */
      const open = (chosen, prefill, blocked) => {
        ask(chosen.text, prefill, blocked, chosen.source).then((comment) => {
          if (comment === null) return
          const seat = previewBridges.get(chosen.sessionId)
          const block = buildBlock(chosen.text, comment, t, chosen.source)
          if (seat !== undefined && seat.inputActions.insertQuote(block.text, block.summary)) {
            document.getSelection()?.removeAllRanges()
            return
          }
          open(chosen, comment, true)
        })
      }

      return h('button', {
        ref: button,
        type: 'button',
        className: 'qc-action qc-preview-action',
        'aria-label': t('quote.add'),
        // Keep the preview selection alive: moving focus would collapse it.
        onPointerDown: (event) => { event.preventDefault() },
        onClick: () => {
          const chosen = target.current
          if (chosen === null) return
          hide()
          open(chosen, '', false)
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

      const title = pending.source === undefined ? t('dialog.title') : t('dialog.titleFile')

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
        'aria-label': title,
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
      h('h2', { className: 'qc-title' }, title),
      h('div', { className: 'qc-block', role: 'group' },
        pending.source !== undefined
          && h('div', { className: 'qc-source', title: whereOf(pending.source) }, whereOf(pending.source)),
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
      ctx.effect(() => () => { previewBridges.clear() }, 'quote-comment: preview seats')

      // priority -1 shadows the shipped cell at 0; the lowest priority renders.
      ctx.slots.inject('conversation.chat.text-interaction', () => ctx.slots.register({
        name: 'conversation.chat.text-interaction',
        key: 'quote',
        priority: -1,
        locale: NS,
        inject: () => ({ ask: broker.ask }),
      }, QuoteCommentAction))

      // One invisible entry per mounted composer publishes that Session's input
      // seat; the floating preview action inserts through it, so a preview is
      // quotable exactly while its Session's composer can accept a draft.
      ctx.slots.inject('conversation.composer.dock', () => ctx.slots.register({
        name: 'conversation.composer.dock',
        id: 'quote-comment.preview-bridge',
      }, PreviewComposerBridge))

      // The preview surface is frame-wide, not pane-local: the right Sidebar clips
      // its own overflow and owns no text-interaction seat to host a button.
      ctx.slots.inject('shell.overlay', () => ctx.slots.register({
        name: 'shell.overlay',
        id: 'quote-comment.preview-action',
        order: 18,
        inject: () => ({
          ask: broker.ask,
          t,
          hooks: { bridges: bridgeVersion, pending: broker.pending },
        }),
      }, PreviewQuoteAction))

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
