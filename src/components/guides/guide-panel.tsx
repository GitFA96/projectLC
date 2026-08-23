import { GuideEditor } from "@/components/guides/guide-editor";
import { Badge } from "@/components/ui/badge";
import type { GuideKind, GuidePair } from "@/lib/guides";

/**
 * Both guides for one slot, side by side and labelled.
 *
 * Deliberately not merged into one "effective" guide. Collapsing them would
 * have to pick a winner and there is no winner to pick: the shared baseline
 * explains how a thing works, and the guild's own says what they do about it.
 * A reader needs both, and needs to know which is which — a guild reading its
 * own ruling and believing it came with the app is the failure to avoid.
 *
 * The shared half is hidden entirely when nobody has written one and this
 * viewer cannot write one either. Most guilds never have an operator, and an
 * empty "Shared" box on every section of every boss is noise.
 */
export function GuidePanel({
  kind,
  subject,
  section,
  label,
  guides,
  permissions,
  hint,
  placeholder,
}: {
  kind: GuideKind;
  subject: string;
  section: string;
  label: string;
  guides: GuidePair;
  permissions: { own: boolean; operator: boolean };
  hint?: string;
  placeholder?: string;
}) {
  const showTemplate = guides.template !== undefined || permissions.operator;

  return (
    <div className="space-y-3">
      {showTemplate && (
        <div className="rounded-lg border border-dashed p-3">
          <Badge variant="muted" className="mb-1.5 font-normal">
            Shared baseline
          </Badge>
          <GuideEditor
            kind={kind}
            subject={subject}
            section={section}
            label={label}
            guide={guides.template}
            asOperator
            canEdit={permissions.operator}
            hint={hint}
            placeholder={placeholder}
          />
        </div>
      )}
      <div>
        {showTemplate && (
          <Badge variant="secondary" className="mb-1.5 font-normal">
            Ours
          </Badge>
        )}
        <GuideEditor
          kind={kind}
          subject={subject}
          section={section}
          label={label}
          guide={guides.own}
          canEdit={permissions.own}
          hint={hint}
          placeholder={placeholder}
        />
      </div>
    </div>
  );
}
