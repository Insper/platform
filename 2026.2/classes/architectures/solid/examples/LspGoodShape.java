// Proper design: both share a common interface without inheritance between them.
// Each type upholds its own contract independently.
public interface Shape {
    int area();
}

public class Rectangle implements Shape {
    private final int width;
    private final int height;

    public Rectangle(int width, int height) {
        this.width  = width;
        this.height = height;
    }

    @Override
    public int area() { return width * height; }
}

public class Square implements Shape {
    private final int side;

    public Square(int side) { this.side = side; }

    @Override
    public int area() { return side * side; }
}

// Any code expecting a Shape can use Rectangle or Square interchangeably.
// No surprises — each type fulfils the Shape contract correctly.
