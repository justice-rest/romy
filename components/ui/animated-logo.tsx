'use client'

import Image from 'next/image'
import { cn } from '@/lib/utils'

export function AnimatedLogo({
  className,
  ...props
}: React.ComponentProps<'div'>) {
  return (
    <div className={cn('h-8 w-8', className)} {...props}>
      <Image src="/images/Logoo.png" alt="Logo" width={32} height={32} className="w-full h-full" />
    </div>
  )
}
