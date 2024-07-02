import { db } from "@/db"
import { currentUser } from "@clerk/nextjs/server"
import { redirect } from "next/navigation"
import Dashboard from "../../components/Dashboard"

const Page = async () => {

  const user = await currentUser()

  if( !user || !user.id) redirect("/auth-callback?origin=dashboard")

  const dbUser = await db.user2.findFirst({
    where: {
      id: user.id
    }
  })

  if(!dbUser) redirect('/auth-callback?origin=dashboard')

  return (
    <Dashboard />
  )
}

export default Page