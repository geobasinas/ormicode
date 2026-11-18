import {
  activeEditor$,
  cancelLinkEdit$,
  contentEditableWrapperElement$,
  editorRootElementRef$,
  iconComponentFor$,
  linkDialogState$,
  onWindowChange$,
  removeLink$,
  showLinkTitleField$,
  switchFromPreviewToLinkEdit$,
  updateLink$,
  type EditLinkDialog,
  type IconKey,
  type PreviewLinkDialog,
} from '@mdxeditor/editor';
import { useCellValues, usePublisher } from '@mdxeditor/gurx';
import { Popover } from 'radix-ui';
import { useEffect, useRef, useState, type ReactNode } from 'react';

type LinkValues = {
  url: string | undefined;
  text: string | undefined;
  title: string | undefined;
};

function LinkEditForm({
  state,
  showLinkTitleField,
  onSave,
  onCancel,
}: {
  state: EditLinkDialog;
  showLinkTitleField: boolean;
  onSave: (values: LinkValues) => void;
  onCancel: () => void;
}) {
  const [url, setUrl] = useState(state.url);
  const [text, setText] = useState(state.text);
  const [title, setTitle] = useState(state.title);

  return (
    <form
      className="ormi-md-link-edit-form"
      onSubmit={event => {
        event.preventDefault();
        event.stopPropagation();
        onSave({ url, text, title });
      }}
      onKeyDown={event => {
        if (event.key === 'Escape') {
          event.preventDefault();
          event.stopPropagation();
          onCancel();
        }
      }}
    >
      <div className="ormi-md-link-field">
        <label htmlFor="ormi-md-link-url">URL</label>
        <input
          autoFocus
          id="ormi-md-link-url"
          aria-label="URL"
          value={url}
          onChange={event => setUrl(event.currentTarget.value)}
        />
      </div>
      {state.withAnchorText && (
        <div className="ormi-md-link-field">
          <label htmlFor="ormi-md-link-text">Anchor text</label>
          <input
            id="ormi-md-link-text"
            aria-label="Anchor text"
            value={text}
            onChange={event => setText(event.currentTarget.value)}
          />
        </div>
      )}
      {showLinkTitleField && (
        <div className="ormi-md-link-field">
          <label htmlFor="ormi-md-link-title">Link title</label>
          <input
            id="ormi-md-link-title"
            aria-label="Link title"
            value={title}
            onChange={event => setTitle(event.currentTarget.value)}
          />
        </div>
      )}
      <div className="ormi-md-link-actions">
        <button type="submit">Save</button>
        <button type="button" onClick={onCancel}>Cancel</button>
      </div>
    </form>
  );
}

async function copyText(text: string, container: HTMLElement): Promise<boolean> {
  if (navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      // Fall through to the document copy command.
    }
  }

  const previouslyFocused = document.activeElement;
  const selection = document.getSelection();
  const ranges = selection ? Array.from({ length: selection.rangeCount }, (_, index) => selection.getRangeAt(index).cloneRange()) : [];
  const textarea = document.createElement('textarea');
  textarea.value = text;
  textarea.readOnly = true;
  textarea.tabIndex = -1;
  textarea.setAttribute('aria-hidden', 'true');
  Object.assign(textarea.style, { position: 'fixed', top: '0', left: '0', opacity: '0', pointerEvents: 'none' });
  container.appendChild(textarea);

  try {
    textarea.focus({ preventScroll: true });
    textarea.select();
    textarea.setSelectionRange(0, text.length);
    return document.execCommand('copy');
  } catch {
    return false;
  } finally {
    textarea.remove();
    if (selection) {
      selection.removeAllRanges();
      ranges.forEach(range => selection.addRange(range));
    }
    if (previouslyFocused instanceof HTMLElement) previouslyFocused.focus({ preventScroll: true });
  }
}

function LinkPreview({
  state,
  editorRoot,
  iconComponentFor,
  onEdit,
  onRemove,
}: {
  state: PreviewLinkDialog;
  editorRoot: HTMLElement;
  iconComponentFor: (name: IconKey) => ReactNode;
  onEdit: () => void;
  onRemove: () => void;
}) {
  const [copied, setCopied] = useState(false);
  const resetCopyTimer = useRef<number | undefined>(undefined);
  const external = /^https?:\/\//i.test(state.url);

  useEffect(() => () => {
    if (resetCopyTimer.current !== undefined) window.clearTimeout(resetCopyTimer.current);
  }, []);

  const handleCopy = async () => {
    if (!await copyText(state.url, editorRoot)) return;
    setCopied(true);
    if (resetCopyTimer.current !== undefined) window.clearTimeout(resetCopyTimer.current);
    resetCopyTimer.current = window.setTimeout(() => {
      resetCopyTimer.current = undefined;
      setCopied(false);
    }, 1000);
  };

  return (
    <div className="ormi-md-link-preview">
      <a
        className="ormi-md-link-preview-url"
        data-testid="link-dialog-preview"
        href={state.href ?? 'about:blank'}
        {...(external ? { target: '_blank', rel: 'noreferrer' } : {})}
        title={state.url}
      >
        {state.url}
      </a>
      <div className="ormi-md-link-preview-actions">
        <button type="button" title="Edit link URL" aria-label="Edit link URL" onClick={onEdit}>
          {iconComponentFor('edit')}
        </button>
        <button type="button" title="Copy link" aria-label="Copy link" onClick={() => void handleCopy()}>
          {iconComponentFor(copied ? 'check' : 'content_copy')}
        </button>
        <button type="button" title="Remove link" aria-label="Remove link" onClick={onRemove}>
          {iconComponentFor('link_off')}
        </button>
      </div>
    </div>
  );
}

export function OrmiLinkDialog() {
  const [
    editorRootElementRef,
    contentEditableWrapperElement,
    activeEditor,
    iconComponentFor,
    linkDialogState,
    showLinkTitleField,
  ] = useCellValues(
    editorRootElementRef$,
    contentEditableWrapperElement$,
    activeEditor$,
    iconComponentFor$,
    linkDialogState$,
    showLinkTitleField$,
  );
  const publishWindowChange = usePublisher(onWindowChange$);
  const updateLink = usePublisher(updateLink$);
  const cancelLinkEdit = usePublisher(cancelLinkEdit$);
  const switchFromPreviewToLinkEdit = usePublisher(switchFromPreviewToLinkEdit$);
  const removeLink = usePublisher(removeLink$);
  const [editorRootWidth, setEditorRootWidth] = useState(0);
  const portalRoot = editorRootElementRef?.current ?? null;
  const editorRoot = contentEditableWrapperElement;

  useEffect(() => {
    if (!editorRoot) return;
    const measure = () => setEditorRootWidth(editorRoot.getBoundingClientRect().width);
    measure();
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(measure);
    observer.observe(editorRoot);
    return () => observer.disconnect();
  }, [editorRoot]);

  useEffect(() => {
    const scrollContainer = contentEditableWrapperElement?.closest('.mdxeditor-root-contenteditable')
      ?? contentEditableWrapperElement?.querySelector('.mdxeditor-root-contenteditable')
      ?? null;
    const update = () => {
      activeEditor?.getEditorState().read(() => publishWindowChange(true));
    };
    window.addEventListener('resize', update);
    window.addEventListener('scroll', update);
    scrollContainer?.addEventListener('scroll', update);
    return () => {
      window.removeEventListener('resize', update);
      window.removeEventListener('scroll', update);
      scrollContainer?.removeEventListener('scroll', update);
    };
  }, [activeEditor, contentEditableWrapperElement, publishWindowChange]);

  if (linkDialogState.type === 'inactive' || !editorRoot || !portalRoot) return <></>;
  const measuredWidth = editorRoot.getBoundingClientRect().width || editorRootWidth;
  const dialogWidth = Math.max(0, Math.min(300, measuredWidth - 16));
  const { rectangle } = linkDialogState;

  return (
    <Popover.Root open>
      <Popover.Anchor asChild>
        <span
          aria-hidden="true"
          className="ormi-md-link-anchor"
          style={{
            top: rectangle.top,
            left: rectangle.left,
            width: rectangle.width,
            height: rectangle.height,
          }}
        />
      </Popover.Anchor>
      <Popover.Portal container={portalRoot}>
        <Popover.Content
          className="ormi-md-link-dialog"
          side="bottom"
          align="start"
          sideOffset={6}
          collisionBoundary={editorRoot}
          collisionPadding={8}
          avoidCollisions
          sticky="always"
          updatePositionStrategy="always"
          style={{ width: dialogWidth }}
          onEscapeKeyDown={event => {
            if (linkDialogState.type === 'edit') {
              event.preventDefault();
              event.stopPropagation();
              cancelLinkEdit();
            }
          }}
        >
          {linkDialogState.type === 'edit' ? (
            <LinkEditForm
              key={`edit:${linkDialogState.linkNodeKey}`}
              state={linkDialogState}
              showLinkTitleField={showLinkTitleField}
              onSave={updateLink}
              onCancel={cancelLinkEdit}
            />
          ) : (
            <LinkPreview
              state={linkDialogState}
              editorRoot={portalRoot}
              iconComponentFor={iconComponentFor}
              onEdit={switchFromPreviewToLinkEdit}
              onRemove={removeLink}
            />
          )}
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
