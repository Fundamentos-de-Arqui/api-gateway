import java.io.*;
import java.net.*;
import java.util.concurrent.Executors;

public class SimpleHttpServer {
    private static final int PORT = 3002;
    
    public static void main(String[] args) {
        try {
            ServerSocket serverSocket = new ServerSocket(PORT);
            System.out.println("🚀 Java HTTP Server running on port " + PORT);
            System.out.println("📡 Server started successfully");
            System.out.println("🔗 Test URL: http://localhost:" + PORT + "/health");
            
            while (true) {
                Socket clientSocket = serverSocket.accept();
                System.out.println("📥 New connection from: " + clientSocket.getInetAddress());
                
                // Handle request in a separate thread
                Executors.newCachedThreadPool().submit(() -> {
                    try {
                        handleRequest(clientSocket);
                    } catch (IOException e) {
                        System.err.println("❌ Error handling request: " + e.getMessage());
                    }
                });
            }
        } catch (IOException e) {
            System.err.println("❌ Server error: " + e.getMessage());
        }
    }
    
    private static void handleRequest(Socket clientSocket) throws IOException {
        BufferedReader in = new BufferedReader(new InputStreamReader(clientSocket.getInputStream()));
        PrintWriter out = new PrintWriter(clientSocket.getOutputStream(), true);
        
        // Read the request
        String requestLine = in.readLine();
        System.out.println("📨 Request: " + requestLine);
        
        // Simple response
        String response = "HTTP/1.1 200 OK\r\n" +
                         "Content-Type: application/json\r\n" +
                         "Content-Length: 89\r\n" +
                         "\r\n" +
                         "{\"status\":\"ok\",\"message\":\"Java HTTP Server is working!\",\"timestamp\":\"" + 
                         java.time.Instant.now().toString() + "\"}";
        
        out.println(response);
        out.flush();
        
        clientSocket.close();
        System.out.println("✅ Response sent");
    }
}
