import type { CSSProperties, MouseEvent, ReactNode } from 'react';

/** A blueprint frame: hairline square border with four corner registration marks. */
export function Blueprint({
  className = '', style, children, onClick,
}: {
  className?: string;
  style?: CSSProperties;
  children: ReactNode;
  onClick?: (e: MouseEvent<HTMLDivElement>) => void;
}) {
  return (
    <div className={`blueprint ${className}`} style={style} onClick={onClick}>
      <i className="corner tl" />
      <i className="corner tr" />
      <i className="corner bl" />
      <i className="corner br" />
      {children}
    </div>
  );
}
