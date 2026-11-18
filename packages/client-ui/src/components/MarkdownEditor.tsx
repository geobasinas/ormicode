import { MDXEditor } from '@mdxeditor/editor';
import {
  BlockTypeSelect,
  BoldItalicUnderlineToggles,
  CodeToggle,
  CreateLink,
  DiffSourceToggleWrapper,
  InsertCodeBlock,
  InsertTable,
  InsertThematicBreak,
  ListsToggle,
  Separator,
  codeBlockPlugin,
  codeMirrorPlugin,
  diffSourcePlugin,
  headingsPlugin,
  linkDialogPlugin,
  linkPlugin,
  listsPlugin,
  markdownShortcutPlugin,
  quotePlugin,
  tablePlugin,
  thematicBreakPlugin,
  toolbarPlugin,
  type IconKey,
} from '@mdxeditor/editor';
import {
  AlignCenter,
  AlignLeft,
  AlignRight,
  ArrowDown,
  ArrowLeft,
  ArrowRight,
  ArrowUp,
  BetweenHorizontalEnd,
  BetweenVerticalEnd,
  Bold,
  Check,
  ChevronDown,
  CircleAlert,
  Code,
  Copy,
  ExternalLink,
  FileCode,
  FileCode2,
  FileText,
  GitCompare,
  Highlighter,
  Image,
  Italic,
  Link,
  List,
  ListChecks,
  ListOrdered,
  Minus,
  MoreHorizontal,
  MoreVertical,
  Pencil,
  Redo,
  Settings,
  Strikethrough,
  Subscript,
  Superscript,
  Table,
  Type,
  Trash2,
  Undo,
  Underline,
  Unlink,
  X,
  type LucideIcon,
} from 'lucide-react';
import { baseExtensions } from '../features/files/editor.ts';

const icons: Record<IconKey, LucideIcon> = {
  undo: Undo,
  redo: Redo,
  format_bold: Bold,
  format_italic: Italic,
  format_underlined: Underline,
  code: Code,
  strikeThrough: Strikethrough,
  superscript: Superscript,
  subscript: Subscript,
  format_list_bulleted: List,
  format_list_numbered: ListOrdered,
  format_list_checked: ListChecks,
  format_highlight: Highlighter,
  link: Link,
  add_photo: Image,
  table: Table,
  horizontal_rule: Minus,
  frontmatter: FileCode,
  frame_source: Code,
  arrow_drop_down: ChevronDown,
  admonition: CircleAlert,
  rich_text: Type,
  difference: GitCompare,
  markdown: FileCode2,
  open_in_new: ExternalLink,
  link_off: Unlink,
  edit: Pencil,
  content_copy: Copy,
  more_horiz: MoreHorizontal,
  more_vert: MoreVertical,
  close: X,
  settings: Settings,
  delete_big: Trash2,
  delete_small: Trash2,
  format_align_center: AlignCenter,
  format_align_left: AlignLeft,
  format_align_right: AlignRight,
  add_row: BetweenHorizontalEnd,
  add_column: BetweenVerticalEnd,
  insert_col_left: ArrowLeft,
  insert_row_above: ArrowUp,
  insert_row_below: ArrowDown,
  insert_col_right: ArrowRight,
  check: Check,
};

function iconComponentFor(name: IconKey) {
  const Icon = icons[name];
  return <Icon size={14} strokeWidth={1.75} />;
}

export interface MarkdownEditorProps {
  value: string;
  onChange: (md: string) => void;
  placeholder?: string;
}

export function MarkdownEditor({ value, onChange, placeholder }: MarkdownEditorProps) {
  const extensions = baseExtensions();

  return (
    <MDXEditor
      className="ormi-md mdxeditor-full-height"
      contentEditableClassName="ormi-md-content"
      markdown={value}
      onChange={(markdown, initialMarkdownNormalize) => {
        if (!initialMarkdownNormalize) onChange(markdown);
      }}
      placeholder={placeholder}
      iconComponentFor={iconComponentFor}
      plugins={[
        headingsPlugin(),
        listsPlugin(),
        quotePlugin(),
        linkPlugin(),
        linkDialogPlugin(),
        thematicBreakPlugin(),
        tablePlugin(),
        codeBlockPlugin({ defaultCodeBlockLanguage: 'txt' }),
        codeMirrorPlugin({
          codeBlockLanguages: {
            txt: 'Text',
            ts: 'TypeScript',
            tsx: 'TSX',
            js: 'JavaScript',
            json: 'JSON',
            bash: 'Shell',
            css: 'CSS',
            md: 'Markdown',
            py: 'Python',
          },
          codeMirrorExtensions: extensions,
        }),
        markdownShortcutPlugin(),
        diffSourcePlugin({ viewMode: 'rich-text', codeMirrorExtensions: extensions }),
        toolbarPlugin({
          toolbarContents: () => (
            <DiffSourceToggleWrapper options={['rich-text', 'source']}>
              <BlockTypeSelect />
              <Separator />
              <BoldItalicUnderlineToggles options={['Bold', 'Italic']} />
              <CodeToggle />
              <Separator />
              <CreateLink />
              <Separator />
              <ListsToggle options={['bullet', 'number', 'check']} />
              <Separator />
              <InsertTable />
              <InsertCodeBlock />
              <InsertThematicBreak />
            </DiffSourceToggleWrapper>
          ),
        }),
      ]}
    />
  );
}
