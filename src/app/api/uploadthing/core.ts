import { db } from "@/db";
import { currentUser } from "@clerk/nextjs/server";
import { createUploadthing, type FileRouter } from "uploadthing/next";
import { PDFLoader } from "@langchain/community/document_loaders/fs/pdf";
import { pinecone } from "@/lib/pinecone";
import { OpenAIEmbeddings } from "@langchain/openai";
import { PineconeStore } from "@langchain/pinecone";
import { getUserSubscriptionPlan } from "@/lib/stripe";
import { PLANS } from "@/config/stripe";

const f = createUploadthing();

const middleware = async () => {
  const user = await currentUser()

  if(!user || !user.id) throw new Error ("Unauthorized")

  const subscriptionPlan = await getUserSubscriptionPlan()
 
  return { subscriptionPlan, userId: user.id};
}

const onUploadComplete = async ({
  metadata, file
} : {
  metadata: Awaited<ReturnType<typeof middleware>>
  file: {
    key: string
    name: string
    url: string
  }
}) => {

  const isFileExist = await db.file.findFirst({
    where: {
      key: file.key
    }
  })

  if(isFileExist) return

  const createdFile = await db.file.create({
    data: {
        key: file.key,
        name: file.name,
        userId: metadata.userId,
        url: `https://utfs.io/f/${file.key}`,
        uploadStatus: "PROCESSING",
    }
  })

  try {
    const response = await fetch(`https://utfs.io/f/${file.key}`)
    const blob = await response.blob()

    const loader = new PDFLoader(blob)

    const pageLevelDocs = await loader.load()

    const pagesAmt = pageLevelDocs.length

    const { subscriptionPlan } = metadata
    const { isSubscribed } = subscriptionPlan

    const isProExceeded = pagesAmt > PLANS.find((plan) => plan.name === "Pro")!.pagesPerPdf
    const isFreeExceeded = pagesAmt > PLANS.find((plan) => plan.name === "Free")!.pagesPerPdf

    if((isSubscribed && isProExceeded) || (!isSubscribed && isFreeExceeded)) {
      await db.file.update({
        data: {
          uploadStatus: "FAILED"
        },
        where: {
          id: createdFile.id
        }
      })
    } 

    // Vectorize and index entire document

    const pineconeIndex = pinecone.index(process.env.PINECONE_INDEX!)

    const embeddings = new OpenAIEmbeddings({
      openAIApiKey: process.env.OPENAI_API_KEY,
    })

    await PineconeStore.fromDocuments(pageLevelDocs, embeddings, {
      pineconeIndex,
      namespace: createdFile.id,
      maxConcurrency: 5,
      textKey: "text"
    })

    await db.file.update({
      data: {
        uploadStatus: "SUCCESS",
      },
      where: {
        id: createdFile.id
      }
    })
    
  } catch (error) {
    console.log("ERRRORRR:",error)

    await db.file.update({
      data: {
        uploadStatus: "FAILED",
      },
      where: {
        id: createdFile.id
      }
    })
  }
}
 
export const ourFileRouter = {
  freePlanUploader: f({ pdf: { maxFileSize: "4MB" } })
    .middleware(middleware)
    .onUploadComplete(onUploadComplete),
  proPlanUploader: f({ pdf: { maxFileSize: "16MB" } })
    .middleware(middleware)
    .onUploadComplete(onUploadComplete)
} satisfies FileRouter;
 
export type OurFileRouter = typeof ourFileRouter;