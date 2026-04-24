'use client';

import Image from 'next/image';

import { getBrandLogo, getBrandMonogram } from '@/lib/brand-logos';

type BrandLogoSize = 'drawer' | 'inline' | 'list';

interface BrandLogoProps {
  brand: string | null | undefined;
  size?: BrandLogoSize;
  className?: string;
  decorative?: boolean;
  align?: 'center' | 'left';
}

const sizeClasses: Record<
  BrandLogoSize,
  {
    logoFrame: string;
    imagePadding: string;
    fallbackFrame: string;
    fallbackText: string;
  }
> = {
  drawer: {
    logoFrame: 'h-14 w-24',
    imagePadding: '',
    fallbackFrame:
      'h-14 w-14 rounded-2xl border border-gray-200 bg-white shadow-sm',
    fallbackText: 'text-sm',
  },
  list: {
    logoFrame: 'h-10 w-16',
    imagePadding: '',
    fallbackFrame:
      'h-10 w-10 rounded-xl border border-gray-200 bg-white shadow-sm',
    fallbackText: 'text-xs',
  },
  inline: {
    logoFrame: 'h-6 w-9',
    imagePadding: '',
    fallbackFrame:
      'h-6 w-6 rounded-md border border-gray-200 bg-white shadow-sm',
    fallbackText: 'text-[10px]',
  },
};

function joinClasses(...values: Array<string | undefined>) {
  return values.filter(Boolean).join(' ');
}

export default function BrandLogo({
  brand,
  size = 'list',
  className,
  decorative = true,
  align = 'center',
}: BrandLogoProps) {
  const logo = getBrandLogo(brand);
  const sizing = sizeClasses[size];
  const sizes = size === 'drawer' ? '96px' : size === 'list' ? '64px' : '36px';

  return (
    <span
      className={joinClasses(
        'relative inline-flex shrink-0 items-center justify-center overflow-hidden',
        logo ? sizing.logoFrame : sizing.fallbackFrame,
        className,
      )}
      aria-hidden={decorative}
    >
      {logo ? (
        <span className={joinClasses('relative block h-full w-full', sizing.imagePadding)}>
          <Image
            src={logo.src}
            alt={decorative ? '' : `${logo.displayName} logo`}
            fill
            sizes={sizes}
            unoptimized
            className={joinClasses('object-contain', align === 'left' ? 'object-left' : undefined)}
          />
        </span>
      ) : (
        <span
          className={joinClasses(
            'inline-flex h-full w-full items-center justify-center bg-gradient-to-br from-slate-100 to-slate-200 font-semibold uppercase tracking-wide text-slate-600',
            sizing.fallbackText,
          )}
        >
          {getBrandMonogram(brand)}
        </span>
      )}
    </span>
  );
}
