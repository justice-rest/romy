'use client'

import { useEffect, useRef, useState } from 'react'

import { Check, ChevronDown, Gauge, Sparkles } from 'lucide-react'

import { ModelType } from '@/lib/types/model-type'
import { cn } from '@/lib/utils'
import { getCookie, setCookie } from '@/lib/utils/cookies'

import { Button } from './ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger
} from './ui/dropdown-menu'
import { HoverCard, HoverCardContent, HoverCardTrigger } from './ui/hover-card'

const MODEL_TYPE_CONFIGS = [
  {
    value: 'speed' as ModelType,
    label: 'Speed',
    description: 'Faster responses with optimized performance',
    icon: Gauge,
    color: 'text-blue-500'
  },
  {
    value: 'quality' as ModelType,
    label: 'Quality',
    description: 'Higher quality responses with advanced reasoning',
    icon: Sparkles,
    color: 'text-purple-500'
  }
]

export function ModelTypeSelector() {
  const [value, setValue] = useState<ModelType>('speed')
  const [indicatorStyle, setIndicatorStyle] = useState<React.CSSProperties>({})
  const [openHoverCard, setOpenHoverCard] = useState<string | null>(null)
  const [justSelected, setJustSelected] = useState(false)
  const [dropdownOpen, setDropdownOpen] = useState(false)
  const buttonsRef = useRef<(HTMLButtonElement | null)[]>([])

  useEffect(() => {
    const savedType = getCookie('modelType')
    if (savedType && ['speed', 'quality'].includes(savedType)) {
      setValue(savedType as ModelType)
    }
  }, [])

  useEffect(() => {
    const selectedIndex = MODEL_TYPE_CONFIGS.findIndex(
      config => config.value === value
    )
    const selectedButton = buttonsRef.current[selectedIndex]

    if (selectedButton) {
      const { offsetLeft, offsetWidth } = selectedButton
      setIndicatorStyle({
        transform: `translateX(${offsetLeft}px)`,
        width: `${offsetWidth}px`
      })
    }
  }, [value])

  const handleTypeSelect = (type: ModelType) => {
    setValue(type)
    setCookie('modelType', type)
    setOpenHoverCard(null)
    setDropdownOpen(false)
    setJustSelected(true)

    setTimeout(() => {
      setJustSelected(false)
    }, 500)
  }

  const selectedType = MODEL_TYPE_CONFIGS.find(config => config.value === value)
  const SelectedIcon = selectedType?.icon

  return (
    <>
      {/* Mobile Dropdown */}
      <div className="sm:hidden">
        <DropdownMenu open={dropdownOpen} onOpenChange={setDropdownOpen}>
          <DropdownMenuTrigger asChild>
            <Button
              variant="outline"
              className="text-sm rounded-full shadow-none gap-1 transition-all"
            >
              {SelectedIcon && (
                <SelectedIcon
                  className={cn(
                    'h-4 w-4 transition-colors',
                    selectedType?.color
                  )}
                />
              )}
              <span className="text-xs font-medium">{selectedType?.label}</span>
              <ChevronDown
                className={cn(
                  'h-3 w-3 ml-1 opacity-50 transition-transform duration-200',
                  dropdownOpen && 'rotate-180'
                )}
              />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="w-64" sideOffset={5}>
            {MODEL_TYPE_CONFIGS.map(config => {
              const TypeIcon = config.icon
              const isSelected = value === config.value
              return (
                <DropdownMenuItem
                  key={config.value}
                  onClick={() => handleTypeSelect(config.value)}
                  className="relative flex flex-col items-start gap-1 py-2 pl-8 pr-2 cursor-pointer focus:outline-none"
                >
                  {isSelected && (
                    <Check className="absolute left-2 top-2.5 h-4 w-4" />
                  )}
                  <div className="flex items-center gap-2">
                    <TypeIcon
                      className={cn('h-4 w-4 transition-colors', config.color)}
                    />
                    <span className="text-sm font-medium">{config.label}</span>
                  </div>
                  <div className="flex flex-col gap-0.5 ml-6">
                    <span className="text-xs text-muted-foreground">
                      {config.description}
                    </span>
                  </div>
                </DropdownMenuItem>
              )
            })}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      {/* Desktop Toggle */}
      <div className="hidden sm:block">
        <div className="relative inline-flex items-center rounded-full bg-background border p-1">
          {/* Animated background indicator */}
          <div
            className="absolute inset-y-1 rounded-full bg-muted transition-all duration-200 ease-out"
            style={indicatorStyle}
          />

          {/* Type buttons */}
          <div className="relative flex items-center">
            {MODEL_TYPE_CONFIGS.map((config, index) => {
              const Icon = config.icon
              const isSelected = value === config.value

              return (
                <HoverCard
                  key={config.value}
                  open={!justSelected && openHoverCard === config.value}
                  onOpenChange={open => {
                    if (!justSelected) {
                      setOpenHoverCard(open ? config.value : null)
                    }
                  }}
                  openDelay={100}
                  closeDelay={50}
                >
                  <HoverCardTrigger asChild>
                    <button
                      type="button"
                      ref={el => {
                        buttonsRef.current[index] = el
                      }}
                      onClick={() => handleTypeSelect(config.value)}
                      className={cn(
                        'relative z-10 flex items-center justify-center rounded-full px-3 py-2 transition-colors duration-200',
                        isSelected
                          ? 'text-foreground'
                          : 'text-muted-foreground hover:text-foreground/80'
                      )}
                      aria-label={`${config.label} mode`}
                      aria-pressed={isSelected}
                    >
                      <Icon
                        className={cn(
                          'h-3.5 w-3.5 transition-colors',
                          isSelected ? config.color : ''
                        )}
                      />
                    </button>
                  </HoverCardTrigger>

                  <HoverCardContent
                    className="w-72"
                    align="center"
                    sideOffset={8}
                  >
                    <div className="space-y-2">
                      <div className="flex items-center gap-2">
                        <Icon className={cn('h-5 w-5', config.color)} />
                        <h4 className="text-sm font-semibold">
                          {config.label}
                        </h4>
                      </div>
                      <p className="text-xs text-muted-foreground leading-tight">
                        {config.description}
                      </p>
                    </div>
                  </HoverCardContent>
                </HoverCard>
              )
            })}
          </div>
        </div>
      </div>
    </>
  )
}
