require("dotenv").config();
const express = require("express");
const app = express();
const { MongoClient, ServerApiVersion, ObjectId } = require("mongodb");
const cors = require("cors");
const jwt = require("jsonwebtoken");
const port = process.env.PORT || 5000;

app.use(cors());
app.use(express.json());

const createToken = (user) => {
  const token = jwt.sign(
    {
      email: user?.email,
    },
    process.env.JWT_SECRET,
    { expiresIn: "7d" }
  );
  return token;
};

const verifyToken = (req, res, next) => {
  const token = req.headers.authorization?.split(" ")[1];
  if (!token) {
    return res.status(401).send("You are not authorized");
  }

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    req.decoded = decoded;
    next();
  } catch (error) {
    return res.status(401).send("You are not authorized");
  }
};

const verifyAdmin = async (req, res, next) => {
  try {
    const email = req.decoded.email;
    const query = { email: email };
    const user = await userCollection.findOne(query);
    if (user?.role !== 'admin') {
      return res.status(403).send({ error: true, message: 'Forbidden message' });
    }
    next();
  } catch (error) {
    console.error("Error verifying admin:", error);
    return res.status(500).send("Internal Server Error");
  }
};

const uri = process.env.MONGODB_URL;

const client = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  }
});

let userCollection;

async function run() {
  try {
    await client.connect();
    const database = client.db("bookMyEvent");
    userCollection = database.collection("userCollection");
    const eventCollection = database.collection("eventCollection");
    const bookingCollection = database.collection("bookingCollection");
    const paymentCollection = database.collection("paymentCollection");

    app.post("/events", verifyToken, verifyAdmin, async (req, res) => {
      const event = req.body;
      const result = await eventCollection.insertOne(event);
      res.send(result);
    });

    app.get("/events", async (req, res) => {
      const cursor = eventCollection.find({});
      const result = await cursor.toArray();
      res.send(result);
    });

    app.get("/events/:id", async (req, res) => {
      const id = req.params.id;
      const result = await eventCollection.findOne({ _id: new ObjectId(id) });
      res.send(result);
    });

    app.put("/events/:id", verifyToken, verifyAdmin, async (req, res) => {
      const id = req.params.id;
      const updatedEvent = req.body;

      try {
        const result = await eventCollection.updateOne(
          { _id: new ObjectId(id) },
          { $set: { ...updatedEvent, _id: new ObjectId(id) } },
          { upsert: false }
        );

        if (result.modifiedCount === 0) {
          return res.status(404).send("Event not found or no changes made.");
        }

        res.status(200).send("Event updated successfully!");
      } catch (error) {
        console.error("Error updating event:", error);
        res.status(500).send("Internal Server Error");
      }
    });

    app.delete("/events/:id", verifyToken, verifyAdmin, async (req, res) => {
      const id = req.params.id;
      const query = { _id: new ObjectId(id) };
      const result = await eventCollection.deleteOne(query);
      res.send(result);
    });

    app.post("/booking", verifyToken, async (req, res) => {
      const booking = req.body;
      const result = await bookingCollection.insertOne(booking);
      res.send(result);
    });

    app.get("/booking_tickets/:email", async (req, res) => {
      const email = req.params.email;

      try {
        console.log(email);

        const query = { email: email };
        const bookings = await bookingCollection.find(query).toArray();

        console.log(bookings);

        const eventIds = bookings.map(booking => new ObjectId(booking.eventId));

        const eventsQuery = { _id: { $in: eventIds } };
        const events = await eventCollection.find(eventsQuery).toArray();

        const enrichedBookings = bookings.map(booking => {
          const event = events.find(event => event._id.equals(new ObjectId(booking.eventId)));
          return {
            ...booking,
            event: {
              title: event.title,
              image: event.image
            }
          };
        });

        res.send(enrichedBookings);
      } catch (error) {
        console.error("Error fetching booking details:", error);
        res.status(500).json({ error: "Internal server error" });
      }
    });

 
    app.post("/process_payment", verifyToken, async (req, res) => {
      const { ticketId, paymentDetails } = req.body;
    
      try {
        const booking = await bookingCollection.findOne({ _id: new ObjectId(ticketId) });
    
        if (!booking) {
          return res.status(404).json({ error: "Ticket not found" });
        }
    
        const eventUpdateResult = await eventCollection.updateOne(
          { _id: new ObjectId(booking.eventId) },
          { $inc: { "tickets.available": -parseInt(booking.tickets) } }
        );
    
        if (eventUpdateResult.modifiedCount === 0) {
          return res.status(500).json({ error: "Failed to update event tickets" });
        }
    
        const paymentData = {
          ...paymentDetails,
          email: booking.email,
          eventId: booking.eventId,
          tickets: booking.tickets,
          totalPrice: booking.totalPrice,
          paymentDate: new Date(),
        };
    
        const paymentResult = await paymentCollection.insertOne(paymentData);
    
        const deleteResult = await bookingCollection.deleteOne({ _id: new ObjectId(ticketId) });
    
        if (deleteResult.deletedCount === 0) {
          return res.status(500).json({ error: "Failed to delete the ticket" });
        }
    
        res.json({ message: "Payment processed and ticket deleted successfully", paymentId: paymentResult.insertedId });
      } catch (error) {
        console.error("Error processing payment:", error);
        res.status(500).json({ error: "Internal server error" });
      }
    });


    // User api
    app.post("/user", async (req, res) => {
      const user = req.body;
      const token = createToken(user);
      const isUserExist = await userCollection.findOne({ email: user?.email });
      if (isUserExist?._id) {
        return res.send({
          status: "success",
          message: "Login success",
          token
        });
      }
      await userCollection.insertOne(user);
      return res.send({ token });
    });

    app.get("/all_user", async (req, res) => {
      try {
        const userData = await userCollection.find({}).toArray();
        res.send(userData);
      } catch (error) {
        console.error("Error fetching users:", error);
        res.status(500).send("Error fetching users");
      }
    });

    app.get("/users/admin/:email", async (req, res) => {
      const email = req.params.email;
      const query = { email: email };
      try {
        const user = await userCollection.findOne(query);
        const isAdmin = user?.role === 'admin';
        res.send({ admin: isAdmin });
      } catch (error) {
        console.error("Error checking admin status:", error);
        res.status(500).send({ error: true, message: "Internal Server Error" });
      }
    });

    app.put("/user/:id", verifyToken, verifyAdmin, async (req, res) => {
      const userId = req.params.id;
      const updatedUser = req.body;

      try {
        const result = await userCollection.findOneAndUpdate(
          { _id: new ObjectId(userId) },
          { $set: updatedUser },
          { upsert: false, returnDocument: "after" }
        );

        if (!result.value) {
          return res.status(404).send("User not found");
        }

        res.send(result.value);
      } catch (error) {
        console.error("Error updating user role:", error);
        res.status(500).send("Error updating user role");
      }
    });

    app.delete("/user/:id", verifyToken, verifyAdmin, async (req, res) => {
      const userId = req.params.id;
      try {
        const deletedUser = await userCollection.findOneAndDelete({
          _id: new ObjectId(userId),
        });

        if (!deletedUser.value) {
          return res.status(404).send("User not found");
        }

        res.send(deletedUser.value);
      } catch (error) {
        console.error("Error deleting user:", error);
        res.status(500).send("Error deleting user");
      }
    });

    await client.db("admin").command({ ping: 1 });
    console.log("Successfully connected to MongoDB!");
  } catch (error) {
    console.error("Error connecting to MongoDB:", error);
  }
}

run().catch(console.dir);

app.get("/", (req, res) => {
  res.send("Server is Running...");
});

app.listen(port, () => {
  console.log(`App is listening on port: ${port}`);
});
