public class Rectangle {
    protected int width;
    protected int height;

    public void setWidth(int w)  { this.width  = w; }
    public void setHeight(int h) { this.height = h; }
    public int area()            { return width * height; }
}

// VIOLATION: Square overrides setters in a way that breaks Rectangle's contract.
// Client code that sets width and height independently will get wrong results.
public class Square extends Rectangle {

    @Override
    public void setWidth(int w) {
        this.width  = w;
        this.height = w; // forces both dimensions to be equal
    }

    @Override
    public void setHeight(int h) {
        this.width  = h; // forces both dimensions to be equal
        this.height = h;
    }
}

// Client code expecting Rectangle behaviour:
// rect.setWidth(5);   rect.setHeight(3);
// assert rect.area() == 15;   ← FAILS for Square: area() returns 9
