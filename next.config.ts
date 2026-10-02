/**
 * invita — Next.js configuration.
 *
 * The next-intl plugin wires our request-scoped i18n config
 * (src/i18n/request.ts) into the App Router so server components can read
 * the active locale and its messages.
 */
import type { NextConfig } from 'next';
import createNextIntlPlugin from 'next-intl/plugin';

const withNextIntl = createNextIntlPlugin('./src/i18n/request.ts');

const nextConfig: NextConfig = {
  // Add your Supabase Storage host here once you start serving uploaded
  // hero images through next/image, e.g.:
  // images: { remotePatterns: [{ protocol: 'https', hostname: '<project>.supabase.co' }] },
};

export default withNextIntl(nextConfig);
