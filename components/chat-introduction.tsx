'use client'

import { motion } from 'framer-motion'
import { useMemo, useState, useEffect } from 'react'
import { useCurrentUserName } from '@/hooks/use-current-user-name'

const greetings = [
  "How's your day going?",
  'What are you working on today?',
  "What's on your mind?",
  'What brings you here today?',
  "Got something cool you're building?",
  "What's cooking?",
  'What are we figuring out today?',
  "What's the plan for today?",
  'Whatcha up to?',
  "What's the mission today?"
]

export const Greeting = () => {
  const userName = useCurrentUserName()
  const [timeBasedGreeting, setTimeBasedGreeting] = useState('Hello')
  
  useEffect(() => {
    const hour = new Date().getHours()
    setTimeBasedGreeting(hour < 12 ? "G'Day" : 'Hello')
  }, [])
  
  const randomGreeting = useMemo(
    () => greetings[Math.floor(Math.random() * greetings.length)],
    []
  )

  return (
    <div
      className="mx-auto flex size-full max-w-3xl flex-col justify-center px-4 md:px-4"
      key="overview"
    >
      <motion.div
        animate={{ opacity: 1, y: 0 }}
        className="font-semibold text-xl md:text-2xl"
        exit={{ opacity: 0, y: 10 }}
        initial={{ opacity: 0, y: 10 }}
        transition={{ delay: 0.5 }}
      >
        {timeBasedGreeting}, {userName}!
      </motion.div>
      <motion.div
        animate={{ opacity: 1, y: 0 }}
        className="text-xl text-zinc-500 md:text-2xl"
        exit={{ opacity: 0, y: 10 }}
        initial={{ opacity: 0, y: 10 }}
        transition={{ delay: 0.6 }}
      >
        {randomGreeting}
      </motion.div>
    </div>
  )
}
