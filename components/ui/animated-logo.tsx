'use client'

import { cn } from '@/lib/utils'

export function AnimatedLogo({
  className,
  ...props
}: React.ComponentProps<'div'>) {
  return (
    <div className={cn('h-8 w-8', className)} {...props}>
      <img src="/images/logoo.png" alt="Logo" width={32} height={32} className="w-full h-full" />
    </div>
  )
}
