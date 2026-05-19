'use client';

import { useEffect, useState } from 'react';
import QRCode from 'qrcode';

type Props = {
  value: string;
  size?: number;
  margin?: number;
  alt?: string;
  style?: React.CSSProperties;
};

export function QRCodeImg({ value, size = 64, margin = 1, alt, style }: Props) {
  const [src, setSrc] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    QRCode.toDataURL(value, {
      margin,
      width: size * 2, // render at 2x for crispness
      errorCorrectionLevel: 'M',
      color: { dark: '#000000', light: '#ffffff' },
    })
      .then((url) => {
        if (!cancelled) setSrc(url);
      })
      .catch(() => {
        if (!cancelled) setSrc(null);
      });
    return () => {
      cancelled = true;
    };
  }, [value, size, margin]);

  if (!src) {
    return (
      <div
        aria-hidden
        style={{
          width: size,
          height: size,
          background: 'var(--jnj-grey-200, #eee)',
          borderRadius: 4,
          ...style,
        }}
      />
    );
  }

  return (
    <img
      src={src}
      alt={alt ?? 'QR code'}
      width={size}
      height={size}
      style={{
        width: size,
        height: size,
        display: 'block',
        background: '#fff',
        borderRadius: 4,
        ...style,
      }}
    />
  );
}
