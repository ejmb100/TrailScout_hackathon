import React from 'react';
import { ExternalLink } from 'lucide-react';
import type { ExternalTrailLink } from '../utils/externalTrailLinks';

interface ExternalTrailLinksProps {
  links: ExternalTrailLink[];
  className?: string;
  /** Stop card click handlers when links live inside selectable tiles. */
  stopPropagation?: boolean;
}

const ExternalTrailLinks: React.FC<ExternalTrailLinksProps> = ({
  links,
  className = '',
  stopPropagation = false,
}) => {
  if (links.length === 0) return null;

  return (
    <div
      className={`flex flex-wrap items-center gap-1.5 ${className}`}
      onClick={stopPropagation ? (event) => event.stopPropagation() : undefined}
    >
      <span className="text-[8px] font-bold uppercase tracking-wider text-offwhite/35 shrink-0">
        Explore
      </span>
      {links.map((link) => (
        <a
          key={link.id}
          href={link.href}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-0.5 rounded border border-white/10 bg-white/5 px-1.5 py-0.5 text-[8px] font-semibold text-teal hover:bg-teal/15 hover:text-teal transition-colors"
          title={`Open ${link.label} in a new tab`}
        >
          {link.label}
          <ExternalLink className="w-2.5 h-2.5 shrink-0 opacity-70" />
        </a>
      ))}
    </div>
  );
};

export default ExternalTrailLinks;
