/**
 * Phase 2 以降で実装されるビュー用のプレースホルダー。
 */
export function Placeholder({
  title,
  phase,
  description
}: {
  title: string;
  phase?: string;
  description?: string;
}): JSX.Element {
  return (
    <div className="h-full flex items-center justify-center p-8">
      <div className="text-center max-w-xl">
        <h2 className="text-xl mb-2">{title}</h2>
        {phase && (
          <p className="text-sm text-nndd-subtext">{phase} で実装予定</p>
        )}
        {description && (
          <p className="mt-3 text-sm text-nndd-subtext">{description}</p>
        )}
      </div>
    </div>
  );
}
