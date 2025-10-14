import { createClient } from '@/lib/supabase/client'
import { useEffect, useState } from 'react'

export const useCurrentUserImage = () => {
  const [image, setImage] = useState<string | null>(null)

  useEffect(() => {
    const fetchUserImage = async () => {
      const { data, error } = await createClient().auth.getSession()
      if (error) {
        console.error(error)
      }

      const user = data.session?.user
      const avatarUrl = user?.user_metadata.avatar_url

      if (avatarUrl) {
        setImage(avatarUrl)
      } else if (user) {
        const seed = user.user_metadata.full_name || user.email || 'default'
        setImage(`https://api.dicebear.com/9.x/dylan/svg?seed=${encodeURIComponent(seed)}`)
      } else {
        setImage(null)
      }
    }
    fetchUserImage()
  }, [])

  return image
}
